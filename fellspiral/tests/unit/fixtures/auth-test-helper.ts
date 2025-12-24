import admin from 'firebase-admin';

const PROJECT_ID = 'demo-test';

/**
 * AuthTestHelper generates Firebase Auth tokens for unit tests
 * Uses the Firebase Auth Emulator when FIREBASE_AUTH_EMULATOR_HOST is set
 */
// TODO(#486): Implement singleton pattern to prevent multiple Firebase Admin app instances
export class AuthTestHelper {
  private app: admin.app.App;
  private auth: admin.auth.Auth;

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
    this.app = admin.initializeApp(
      {
        projectId: PROJECT_ID,
        // Note: We do NOT provide credentials for emulator
        // The emulator does not require authentication
      },
      `auth-test-helper-${Date.now()}`
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
  // TODO(#486): Add branded type for UserId with validation
  async createUserAndGetToken(uid: string, claims: Record<string, unknown> = {}): Promise<string> {
    // Ensure user exists (create if not already present)
    await this.ensureUserExists(uid);

    // Generate a custom token and exchange for ID token
    const customToken = await this.auth.createCustomToken(uid, claims);
    return this.exchangeCustomTokenForIdToken(customToken);
  }

  /**
   * Ensure a test user exists in the emulator
   */
  private async ensureUserExists(uid: string): Promise<void> {
    try {
      await this.auth.createUser({
        uid,
        email: `${uid}@test.example.com`,
        emailVerified: true,
      });
      console.log(`✓ Created user ${uid} in emulator`);
    } catch (error: any) {
      if (error.code === 'auth/uid-already-exists') {
        console.log(`ℹ User ${uid} already exists in emulator`);
      } else {
        // Unexpected error - log with full context and re-throw
        console.error(`Failed to create user ${uid}`, {
          uid,
          email: `${uid}@test.example.com`,
          errorCode: error?.code,
          errorMessage: error?.message,
          emulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
        });
        throw new Error(`Failed to create test user ${uid}: ${error?.message || String(error)}`);
      }
    }
  }

  /**
   * Exchange a custom token for an ID token via emulator REST API
   */
  private async exchangeCustomTokenForIdToken(customToken: string): Promise<string> {
    const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const response = await fetch(
      `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to exchange token: ${JSON.stringify(error)}`);
    }

    const data = (await response.json()) as { idToken: string };
    return data.idToken;
  }

  /**
   * Delete a test user from the emulator
   *
   * NOTE: Logs errors but doesn't throw - cleanup errors shouldn't fail tests
   * if the user doesn't exist. However, other errors are logged with full context.
   */
  async deleteUser(uid: string): Promise<void> {
    try {
      await this.auth.deleteUser(uid);
      console.log(`✓ Deleted test user ${uid}`);
    } catch (error: any) {
      console.error(`CLEANUP WARNING: Failed to delete user ${uid}`, {
        uid,
        errorMessage: error?.message,
        errorCode: error?.code,
        emulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      });
      // Don't throw - user may not exist, which is fine for cleanup
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
    } catch (error: any) {
      console.error('CRITICAL: AuthTestHelper cleanup failed', {
        appName: this.app.name,
        errorMessage: error?.message,
        errorCode: error?.code,
      });
      throw error; // Cleanup failures should be visible to test framework
    }
  }
}
