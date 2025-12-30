import admin from 'firebase-admin';

const PROJECT_ID = 'demo-test';

/**
 * Branded type for Firebase user IDs to prevent invalid values at compile time
 */
export type UserId = string & { readonly __brand: 'UserId' };

/**
 * Create a validated UserId from a string
 * @param uid The user ID string to validate
 * @throws Error if uid is empty or contains only whitespace
 */
export function createUserId(uid: string): UserId {
  if (!uid || uid.trim().length === 0) {
    throw new Error('UserId cannot be empty or whitespace-only');
  }
  return uid as UserId;
}

/**
 * Firebase error type for type-safe error handling
 */
interface FirebaseError extends Error {
  code: string;
}

/**
 * Type guard to check if an error is a Firebase error with a code property
 */
function isFirebaseError(error: unknown): error is FirebaseError {
  return (
    error instanceof Error && 'code' in error && typeof (error as FirebaseError).code === 'string'
  );
}

/**
 * AuthTestHelper generates Firebase Auth tokens for unit tests
 * Uses the Firebase Auth Emulator when FIREBASE_AUTH_EMULATOR_HOST is set
 */
export class AuthTestHelper {
  private static instanceCount = 0;
  private app: admin.app.App;
  private auth: admin.auth.Auth;
  private instanceId: number;

  constructor() {
    // Verify Auth emulator is available
    const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (!authEmulatorHost) {
      throw new Error(
        'FIREBASE_AUTH_EMULATOR_HOST environment variable not set. ' +
          'Did you run: ./infrastructure/scripts/start-emulators.sh'
      );
    }

    // CRITICAL: Delete GOOGLE_APPLICATION_CREDENTIALS when using emulator
    // In CI, this env var points to a service account key file. Firebase Admin SDK
    // tries to load it BEFORE checking if we're connecting to an emulator, causing
    // "Invalid contents in the credentials file" error.
    // The emulator doesn't need credentials, so we explicitly remove the env var.
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log(
        '⚠️  Removing GOOGLE_APPLICATION_CREDENTIALS to use emulator (was:',
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        ')'
      );
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    // Initialize Firebase Admin SDK with emulator
    // The SDK automatically connects to the emulator when FIREBASE_AUTH_EMULATOR_HOST is set
    // Do NOT use process.env.GCP_PROJECT_ID - CI sets it to production project
    // Use atomic counter for guaranteed unique app names (avoids timestamp collision)
    this.instanceId = AuthTestHelper.instanceCount++;
    this.app = admin.initializeApp(
      {
        projectId: PROJECT_ID,
        // Note: We do NOT provide credentials for emulator
        // The emulator does not require authentication
      },
      `auth-test-helper-${this.instanceId}`
    );

    this.auth = admin.auth(this.app);

    console.log(`✓ AuthTestHelper initialized with emulator at ${authEmulatorHost}`);
  }

  /**
   * Create a test user and return a valid Firebase ID token
   * @param uid User ID (should match test data)
   * @param claims Optional custom claims to add to the token
   * @returns ID token string that can be used for authentication
   */
  async createUserAndGetToken(uid: UserId, claims: Record<string, unknown> = {}): Promise<string> {
    // Ensure user exists (create if not already present)
    await this.ensureUserExists(uid);

    // Generate a custom token and exchange for ID token
    const customToken = await this.auth.createCustomToken(uid, claims);
    return this.exchangeCustomTokenForIdToken(customToken);
  }

  /**
   * Ensure a test user exists in the emulator
   */
  private async ensureUserExists(uid: UserId): Promise<void> {
    try {
      await this.auth.createUser({
        uid,
        email: `${uid}@test.example.com`,
        emailVerified: true,
      });
      console.log(`✓ Created user ${uid} in emulator`);
    } catch (error: unknown) {
      if (isFirebaseError(error) && error.code === 'auth/uid-already-exists') {
        console.log(`ℹ User ${uid} already exists in emulator`);
        return;
      }

      // Unexpected error - log with full context and preserve original error
      const errorCode = isFirebaseError(error) ? error.code : 'unknown';
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(`Failed to create user ${uid}`, {
        uid,
        email: `${uid}@test.example.com`,
        errorCode,
        errorMessage,
        emulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      });

      // Enhance error message but preserve original error object
      if (error instanceof Error) {
        error.message =
          `Failed to create test user ${uid}:\n` +
          `  Error code: ${errorCode}\n` +
          `  Error: ${errorMessage}\n` +
          `  Emulator: ${process.env.FIREBASE_AUTH_EMULATOR_HOST}\n` +
          `  Common causes:\n` +
          `    - Auth emulator not running\n` +
          `    - Network connectivity issues\n` +
          `    - Invalid user data`;
        throw error;
      }

      // Non-Error thrown - wrap it
      throw new Error(`Failed to create test user ${uid}: ${errorMessage}`);
    }
  }

  /**
   * Exchange a custom token for an ID token via emulator REST API
   */
  private async exchangeCustomTokenForIdToken(customToken: string): Promise<string> {
    const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const url = `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
      });
    } catch (fetchError: unknown) {
      // Network error (emulator not running, etc.)
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error('Failed to connect to Auth emulator for token exchange', {
        url,
        emulatorHost: authEmulatorHost,
        error: errorMessage,
      });
      throw new Error(
        `Failed to connect to Auth emulator for token exchange:\n` +
          `  Emulator: ${authEmulatorHost}\n` +
          `  Error: ${errorMessage}\n` +
          `  Action: Check that Firebase Auth emulator is running (./infrastructure/scripts/start-emulators.sh)`
      );
    }

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = await response.text();
      }

      console.error('Auth emulator rejected token exchange', {
        status: response.status,
        statusText: response.statusText,
        emulatorHost: authEmulatorHost,
        errorData,
      });

      throw new Error(
        `Auth emulator rejected token exchange:\n` +
          `  HTTP Status: ${response.status} ${response.statusText}\n` +
          `  Emulator: ${authEmulatorHost}\n` +
          `  Error: ${JSON.stringify(errorData)}\n` +
          `  Common causes:\n` +
          `    - Invalid custom token format\n` +
          `    - Auth emulator restarted (tokens invalidated)\n` +
          `    - Emulator configuration mismatch`
      );
    }

    const data = (await response.json()) as { idToken?: string };
    if (!data.idToken) {
      console.error('Auth emulator response missing idToken', {
        responseData: data,
        emulatorHost: authEmulatorHost,
      });
      throw new Error(
        `Auth emulator response missing idToken field:\n` +
          `  Response: ${JSON.stringify(data)}\n` +
          `  This indicates an unexpected response format from the emulator`
      );
    }

    return data.idToken;
  }

  /**
   * Delete a test user from the emulator
   *
   * NOTE: Only swallows "user not found" errors (expected during cleanup).
   * Throws on unexpected errors to signal cleanup failures that may cause test pollution.
   */
  async deleteUser(uid: UserId): Promise<void> {
    try {
      await this.auth.deleteUser(uid);
      console.log(`✓ Deleted test user ${uid}`);
    } catch (error: unknown) {
      // Only ignore "user not found" - that's fine for cleanup
      if (isFirebaseError(error) && error.code === 'auth/user-not-found') {
        console.log(`ℹ User ${uid} already deleted or never existed`);
        return;
      }

      // Unexpected error during cleanup - log and throw
      const errorCode = isFirebaseError(error) ? error.code : 'unknown';
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(`CLEANUP FAILED: Could not delete user ${uid}`, {
        uid,
        errorCode,
        errorMessage,
        emulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      });

      throw new Error(
        `Failed to delete test user ${uid} during cleanup:\n` +
          `  Error code: ${errorCode}\n` +
          `  Error: ${errorMessage}\n` +
          `  Emulator: ${process.env.FIREBASE_AUTH_EMULATOR_HOST}\n` +
          `  This may cause test pollution and subsequent test failures.\n` +
          `  Common causes:\n` +
          `    - Auth emulator crashed or restarted\n` +
          `    - Network connectivity issues\n` +
          `    - Invalid auth instance state`
      );
    }
  }

  /**
   * Cleanup: delete Firebase Admin app
   *
   * NOTE: This method throws if cleanup fails to prevent resource leaks
   */
  async cleanup(): Promise<void> {
    try {
      await admin.app(this.app.name).delete();
      console.log('✓ AuthTestHelper cleaned up');
    } catch (error: unknown) {
      const errorCode = isFirebaseError(error) ? error.code : 'unknown';
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error('CRITICAL: AuthTestHelper cleanup failed', {
        appName: this.app.name,
        errorCode,
        errorMessage,
      });

      // Preserve original error for stack trace
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`AuthTestHelper cleanup failed: ${errorMessage}`);
    }
  }
}
