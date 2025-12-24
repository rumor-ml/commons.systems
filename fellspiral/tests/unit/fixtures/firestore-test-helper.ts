import admin from 'firebase-admin';
import { Firestore } from '@google-cloud/firestore';
import { AuthTestHelper } from './auth-test-helper.js';
import assert from 'node:assert';

/**
 * FirestoreTestHelper provides utilities for testing Firestore security rules
 * Uses the Firestore Emulator when FIRESTORE_EMULATOR_HOST is set
 */
export class FirestoreTestHelper {
  private static adminFirestore: Firestore | null = null;
  private authHelper: AuthTestHelper;
  private userFirestores: Map<string, Firestore> = new Map();

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

      const projectId = 'demo-test';
      const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

      FirestoreTestHelper.adminFirestore = new Firestore({
        projectId,
        host: firestoreEmulatorHost?.split(':')[0] || '127.0.0.1',
        port: parseInt(firestoreEmulatorHost?.split(':')[1] || '11980'),
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
    const projectId = 'demo-test';
    const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

    const userFirestore = new Firestore({
      projectId,
      host: firestoreEmulatorHost?.split(':')[0] || '127.0.0.1',
      port: parseInt(firestoreEmulatorHost?.split(':')[1] || '11980'),
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
   * Create a card as a specific user
   * @param uid User ID to create card as
   * @param cardData Card data (must include title and type)
   * @param collection Collection name (default: 'cards')
   * @returns Document reference
   */
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
   */
  async cleanup(): Promise<void> {
    try {
      // Clear all collections using admin instance
      const adminDb = this.getAdminFirestore();
      const collections = ['cards', 'cards_pr_123', 'cards_preview_test-branch'];

      for (const collectionName of collections) {
        const snapshot = await adminDb.collection(collectionName).get();
        const batch = adminDb.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        console.log(`✓ Cleared collection ${collectionName}`);
      }

      // Close user Firestore instances
      for (const [uid, firestore] of this.userFirestores.entries()) {
        await firestore.terminate();
        console.log(`✓ Closed Firestore instance for user ${uid}`);
      }
      this.userFirestores.clear();

      // Cleanup auth helper
      await this.authHelper.cleanup();

      console.log('✓ FirestoreTestHelper cleaned up');
    } catch (error) {
      console.error('Failed to cleanup FirestoreTestHelper:', error);
    }
  }
}
