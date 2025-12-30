import admin from 'firebase-admin';
import { Firestore } from '@google-cloud/firestore';
import { AuthTestHelper, createUserId } from './auth-test-helper.js';
import assert from 'node:assert';

const PROJECT_ID = 'demo-test';

/**
 * Card data interface for Firestore security rules testing.
 * Defines the expected structure for card documents.
 *
 * Required fields match Firestore security rules validation:
 * - title: Required by security rules
 * - type: Required by security rules
 * - subtype: Required by security rules (added in #244)
 *
 * Optional fields:
 * - description: Optional text content
 * - Additional fields allowed via index signature for testing flexibility
 */
export interface CardData {
  title: string;
  type: string;
  subtype?: string; // Optional in interface to allow testing missing field scenarios
  description?: string;
  [key: string]: unknown; // Allow additional fields for testing
}

/**
 * Parse emulator host string into host and port components
 * @param hostString - Host string in format "host:port" (e.g., "127.0.0.1:11000")
 * @returns Object with validated host and port
 * @throws Error if hostString format is invalid or port is not a valid number
 */
function parseEmulatorHost(hostString: string): { host: string; port: number } {
  const parts = hostString.split(':');
  if (parts.length !== 2) {
    throw new Error(
      `Invalid emulator host format: "${hostString}". Expected "host:port" (e.g., "127.0.0.1:11000")`
    );
  }

  const [host, portStr] = parts;
  if (!host || host.trim().length === 0) {
    throw new Error(`Invalid host in emulator string: "${hostString}". Host cannot be empty.`);
  }

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port in emulator string: "${hostString}". Port must be a number between 1-65535.`
    );
  }

  return { host: host.trim(), port };
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
  /** Tracks collections used during testing for dynamic cleanup */
  private usedCollections: Set<string> = new Set();

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
   * Public method to allow tests to perform admin operations (e.g., simulating legacy data)
   */
  getAdminFirestore(): Firestore {
    if (!FirestoreTestHelper.adminFirestore) {
      // TODO(#1039): Add context about when/why GOOGLE_APPLICATION_CREDENTIALS is set and impact
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

    // Validate uid and create user with auth token
    const validatedUid = createUserId(uid);
    const idToken = await this.authHelper.createUserAndGetToken(validatedUid);

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
   * @param cardData Card data (must include title and type per security rules)
   * @param collection Collection name (default: 'cards')
   * @returns Document reference
   */
  // TODO(#1042): Test helper creates cards with both createdAt and lastModifiedAt on CREATE
  async createCardAsUser(
    uid: string,
    cardData: CardData,
    collection: string = 'cards'
  ): Promise<admin.firestore.DocumentReference> {
    this.usedCollections.add(collection);
    const userFirestore = await this.getFirestoreAsUser(uid);

    const docRef = userFirestore.collection(collection).doc();
    await docRef.set({
      subtype: 'default', // Default subtype if not specified (required by security rules since #244)
      ...cardData, // cardData spreads after to allow override or explicit omission via undefined
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
   * @param updates Updates to apply (partial CardData)
   * @param collection Collection name (default: 'cards')
   */
  async updateCardAsUser(
    uid: string,
    cardId: string,
    updates: Partial<CardData>,
    collection: string = 'cards'
  ): Promise<void> {
    this.usedCollections.add(collection);
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
    this.usedCollections.add(collection);
    const userFirestore = await this.getFirestoreAsUser(uid);

    await userFirestore.collection(collection).doc(cardId).delete();

    console.log(`✓ Card ${cardId} deleted by user ${uid} from collection ${collection}`);
  }

  /**
   * Assert that an operation throws a permission denied error
   *
   * This helper specifically checks for Firestore PERMISSION_DENIED errors.
   * It re-throws unexpected errors with full context to avoid hiding test
   * infrastructure issues like emulator connectivity problems.
   *
   * @param operation Async operation to test
   * @param message Optional message for assertion
   * @throws Error if operation succeeds or throws an unexpected (non-permission) error
   */
  async assertPermissionDenied(operation: () => Promise<unknown>, message?: string): Promise<void> {
    try {
      await operation();
      assert.fail(message || 'Expected operation to be denied, but it succeeded');
    } catch (error) {
      // Re-throw assertion errors from assert.fail() above
      if (error instanceof assert.AssertionError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = error?.constructor?.name || 'unknown';

      // Check for Firestore permission denied error patterns
      const isPermissionDenied =
        errorMessage.includes('PERMISSION_DENIED') ||
        errorMessage.includes('Missing or insufficient permissions');

      if (isPermissionDenied) {
        console.log(`✓ Operation correctly denied: ${message || errorMessage.substring(0, 100)}`);
        return; // Expected permission denial - test passes
      }

      // Unexpected error type - surface it with full context for debugging
      // Common causes: emulator not running, network issues, malformed test data
      console.error('assertPermissionDenied caught unexpected error', {
        testContext: message || 'unknown',
        errorType,
        errorMessage,
        error,
      });

      throw new Error(
        `assertPermissionDenied caught unexpected error (not PERMISSION_DENIED):\n` +
          `  Test context: ${message || 'unknown'}\n` +
          `  Error type: ${errorType}\n` +
          `  Error message: ${errorMessage}\n` +
          `  This indicates a test infrastructure problem, not a permission denial.\n` +
          `  Common causes: emulator not running, network issues, malformed test data.`
      );
    }
  }

  /**
   * Cleanup: delete test data and close connections
   *
   * NOTE: This method throws if cleanup fails to ensure test pollution is visible.
   * Preserves original errors with context for easier debugging.
   */
  async cleanup(): Promise<void> {
    const errors: Array<{ context: string; error: Error }> = [];

    try {
      // Clear all collections using admin instance
      const adminDb = this.getAdminFirestore();

      // Use dynamically tracked collections instead of hardcoded list
      // This ensures we only clean up collections that were actually used in tests
      const collectionsToClean =
        this.usedCollections.size > 0 ? Array.from(this.usedCollections) : ['cards']; // Fallback to 'cards' if no collections were tracked

      for (const collectionName of collectionsToClean) {
        try {
          const snapshot = await adminDb.collection(collectionName).get();
          const batch = adminDb.batch();
          for (const doc of snapshot.docs) {
            batch.delete(doc.ref);
          }
          await batch.commit();
          console.log(`✓ Cleared collection ${collectionName}`);
        } catch (error) {
          const originalError = error instanceof Error ? error : new Error(String(error));
          console.error(`Failed to clear collection ${collectionName}`, {
            collection: collectionName,
            error: originalError.message,
            errorType: originalError.constructor.name,
          });
          errors.push({ context: `clear collection ${collectionName}`, error: originalError });
        }
      }
      this.usedCollections.clear();

      // Close user Firestore instances
      for (const [uid, firestore] of this.userFirestores.entries()) {
        try {
          await firestore.terminate();
          console.log(`✓ Closed Firestore instance for user ${uid}`);
        } catch (error) {
          const originalError = error instanceof Error ? error : new Error(String(error));
          console.error(`Failed to close Firestore for user ${uid}`, {
            uid,
            error: originalError.message,
          });
          errors.push({ context: `close Firestore for user ${uid}`, error: originalError });
        }
      }
      this.userFirestores.clear();

      // Cleanup auth helper
      try {
        await this.authHelper.cleanup();
      } catch (error) {
        const originalError = error instanceof Error ? error : new Error(String(error));
        console.error('Auth helper cleanup failed', {
          error: originalError.message,
        });
        errors.push({ context: 'auth helper cleanup', error: originalError });
      }

      // Close admin Firestore instance
      if (FirestoreTestHelper.adminFirestore) {
        try {
          await FirestoreTestHelper.adminFirestore.terminate();
          FirestoreTestHelper.adminFirestore = null;
          console.log('✓ Closed admin Firestore instance');
        } catch (error) {
          const originalError = error instanceof Error ? error : new Error(String(error));
          console.error('Failed to close admin Firestore', {
            error: originalError.message,
          });
          errors.push({ context: 'close admin Firestore', error: originalError });
        }
      }

      if (errors.length > 0) {
        // Format error messages while preserving original errors
        const errorMessages = errors
          .map(({ context, error }) => `  - ${context}: ${error.message}`)
          .join('\n');

        console.error(
          `CRITICAL: FirestoreTestHelper cleanup encountered ${errors.length} error(s):\n${errorMessages}`
        );

        // Throw aggregate with original errors preserved for debugging
        throw new AggregateError(
          errors.map((e) => e.error),
          `Cleanup encountered ${errors.length} error(s):\n${errorMessages}`
        );
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
