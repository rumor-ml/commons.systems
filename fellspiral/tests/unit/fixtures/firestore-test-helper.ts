import admin from 'firebase-admin';
import { Firestore } from '@google-cloud/firestore';
import { AuthTestHelper } from './auth-test-helper.js';
import assert from 'node:assert';

const PROJECT_ID = 'demo-test';

/**
 * Parse emulator host string into host and port components
 */
function parseEmulatorHost(hostString: string): { host: string; port: number } {
  const [host, portStr] = hostString.split(':');
  return {
    host: host || '127.0.0.1',
    port: parseInt(portStr || '11000'), // Changed from 11980 to match BASE_FIRESTORE_PORT
  };
}

/**
 * FirestoreTestHelper provides utilities for testing Firestore security rules
 * Uses the Firestore Emulator when FIRESTORE_EMULATOR_HOST is set
 */
export class FirestoreTestHelper {
  private static adminFirestore: Firestore | null = null;
  private authHelper: AuthTestHelper;
  private userFirestores: Map<string, Firestore> = new Map();
  private emulatorHost: { host: string; port: number };

  constructor() {
    this.authHelper = new AuthTestHelper();

    // Verify Firestore emulator is available
    const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (!firestoreEmulatorHost) {
      throw new Error(
        'FIRESTORE_EMULATOR_HOST environment variable not set. ' +
          'Did you run: ./infrastructure/scripts/start-emulators.sh'
      );
    }

    this.emulatorHost = parseEmulatorHost(firestoreEmulatorHost);
    console.log(`✓ FirestoreTestHelper initialized with emulator at ${firestoreEmulatorHost}`);
  }

  /**
   * Get singleton Firestore Admin instance (bypasses security rules)
   */
  private getAdminFirestore(): Firestore {
    if (!FirestoreTestHelper.adminFirestore) {
      // CRITICAL: Delete GOOGLE_APPLICATION_CREDENTIALS when using emulator
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.log(
          '⚠️  Removing GOOGLE_APPLICATION_CREDENTIALS to use emulator (was:',
          process.env.GOOGLE_APPLICATION_CREDENTIALS,
          ')'
        );
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      }

      FirestoreTestHelper.adminFirestore = new Firestore({
        projectId: PROJECT_ID,
        host: this.emulatorHost.host,
        port: this.emulatorHost.port,
        ssl: false,
        customHeaders: {
          Authorization: 'Bearer owner',
        },
      });

      console.log('✓ Firestore Admin instance created');
    }

    return FirestoreTestHelper.adminFirestore;
  }

  /**
   * Get Firestore instance authenticated as a specific user (subject to security rules)
   * @param uid User ID to authenticate as
   * @returns Firestore instance with user authentication
   */
  async getFirestoreAsUser(uid: string): Promise<Firestore> {
    // Return cached instance if available
    if (this.userFirestores.has(uid)) {
      return this.userFirestores.get(uid)!;
    }

    // Create user and get auth token
    const idToken = await this.authHelper.createUserAndGetToken(uid);

    // Create Firestore instance with user auth
    const userFirestore = new Firestore({
      projectId: PROJECT_ID,
      host: this.emulatorHost.host,
      port: this.emulatorHost.port,
      ssl: false,
      customHeaders: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    this.userFirestores.set(uid, userFirestore);
    console.log(`✓ Firestore instance created for user ${uid}`);

    return userFirestore;
  }

  /**
   * Get an unauthenticated Firestore instance (no auth context)
   * Used to test that security rules deny access to unauthenticated users
   */
  getFirestoreAsUnauthenticated(): Firestore {
    const projectId = process.env.GCLOUD_PROJECT || 'demo-test';
    const { host, port } = this.emulatorHost;

    // Create Firestore without authentication
    const firestore = new Firestore({
      projectId,
      host,
      port,
      ssl: false,
      customHeaders: {
        // No Authorization header - simulates unauthenticated access
      },
    });

    return firestore;
  }

  /**
   * Create a card as a specific user
   * @param uid User ID to create card as
   * @param cardData Card data (must include title and type)
   * @param collection Collection name (default: 'cards')
   * @returns Document reference
   */
  // TODO(#486): Define CardData interface instead of Record<string, unknown>
  async createCardAsUser(
    uid: string,
    cardData: Record<string, unknown>,
    collection: string = 'cards'
  ): Promise<admin.firestore.DocumentReference> {
    const userFirestore = await this.getFirestoreAsUser(uid);

    const docRef = userFirestore.collection(collection).doc();
    await docRef.set({
      ...cardData,
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastModifiedBy: uid,
      lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✓ Card ${docRef.id} created by user ${uid} in collection ${collection}`);
    return docRef as unknown as admin.firestore.DocumentReference;
  }

  /**
   * Update a card as a specific user
   * @param uid User ID to update card as
   * @param cardId Card document ID
   * @param updates Updates to apply
   * @param collection Collection name (default: 'cards')
   */
  async updateCardAsUser(
    uid: string,
    cardId: string,
    updates: Record<string, unknown>,
    collection: string = 'cards'
  ): Promise<void> {
    const userFirestore = await this.getFirestoreAsUser(uid);

    await userFirestore
      .collection(collection)
      .doc(cardId)
      .update({
        ...updates,
        lastModifiedBy: uid,
        lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    console.log(`✓ Card ${cardId} updated by user ${uid} in collection ${collection}`);
  }

  /**
   * Delete a card as a specific user
   * @param uid User ID to delete card as
   * @param cardId Card document ID
   * @param collection Collection name (default: 'cards')
   */
  async deleteCardAsUser(uid: string, cardId: string, collection: string = 'cards'): Promise<void> {
    const userFirestore = await this.getFirestoreAsUser(uid);

    await userFirestore.collection(collection).doc(cardId).delete();

    console.log(`✓ Card ${cardId} deleted by user ${uid} from collection ${collection}`);
  }

  /**
   * Assert that an operation throws a permission denied error
   * @param operation Async operation to test
   * @param message Optional message for assertion
   */
  async assertPermissionDenied(operation: () => Promise<unknown>, message?: string): Promise<void> {
    try {
      await operation();
      assert.fail(message || 'Expected operation to be denied, but it succeeded');
    } catch (error) {
      // Check for Firestore permission denied error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        !errorMessage.includes('PERMISSION_DENIED') &&
        !errorMessage.includes('Missing or insufficient permissions')
      ) {
        throw new Error(
          `Expected PERMISSION_DENIED error, but got: ${errorMessage}\n` + (message || '')
        );
      }
      console.log(`✓ Operation correctly denied: ${message || errorMessage.substring(0, 100)}`);
    }
  }

  /**
   * Cleanup: delete test data and close connections
   *
   * NOTE: This method throws if cleanup fails to ensure test pollution is visible
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    try {
      // Clear all collections using admin instance
      const adminDb = this.getAdminFirestore();
      // TODO(#486): Track collections dynamically instead of hardcoding list
      const collections = ['cards', 'cards_pr_123', 'cards_preview_test-branch'];

      for (const collectionName of collections) {
        try {
          const snapshot = await adminDb.collection(collectionName).get();
          const batch = adminDb.batch();
          snapshot.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
          console.log(`✓ Cleared collection ${collectionName}`);
        } catch (error) {
          const err = new Error(
            `Failed to clear collection ${collectionName}: ${error instanceof Error ? error.message : String(error)}`
          );
          console.error(err);
          errors.push(err);
        }
      }

      // Close user Firestore instances
      for (const [uid, firestore] of this.userFirestores.entries()) {
        try {
          await firestore.terminate();
          console.log(`✓ Closed Firestore instance for user ${uid}`);
        } catch (error) {
          const err = new Error(
            `Failed to close Firestore for user ${uid}: ${error instanceof Error ? error.message : String(error)}`
          );
          console.error(err);
          errors.push(err);
        }
      }
      this.userFirestores.clear();

      // Cleanup auth helper
      try {
        await this.authHelper.cleanup();
      } catch (error) {
        const err = new Error(
          `Auth helper cleanup failed: ${error instanceof Error ? error.message : String(error)}`
        );
        console.error(err);
        errors.push(err);
      }

      // Close admin Firestore instance
      if (FirestoreTestHelper.adminFirestore) {
        try {
          await FirestoreTestHelper.adminFirestore.terminate();
          FirestoreTestHelper.adminFirestore = null;
          console.log('✓ Closed admin Firestore instance');
        } catch (error) {
          const err = new Error(
            `Failed to close admin Firestore: ${error instanceof Error ? error.message : String(error)}`
          );
          console.error(err);
          errors.push(err);
        }
      }

      if (errors.length > 0) {
        console.error(
          `CRITICAL: FirestoreTestHelper cleanup encountered ${errors.length} error(s)`,
          {
            errors: errors.map((e) => e.message),
          }
        );
        throw new AggregateError(errors, `Cleanup encountered ${errors.length} error(s)`);
      }

      console.log('✓ FirestoreTestHelper cleaned up');
    } catch (error) {
      if (error instanceof AggregateError) {
        throw error; // Already formatted
      }
      console.error('CRITICAL: FirestoreTestHelper cleanup failed', error);
      throw error;
    }
  }
}
