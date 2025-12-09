import admin from 'firebase-admin';

/**
 * AuthHelper generates Firebase Auth tokens for e2e tests
 * Uses the Firebase Auth Emulator when FIREBASE_AUTH_EMULATOR_HOST is set
 */
export class AuthHelper {
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
    // Always use 'demo-test' to match TestHelpers.firestore projectId
    // Do NOT use process.env.GCP_PROJECT_ID - CI sets it to production project
    const projectId = 'demo-test';
    this.app = admin.initializeApp(
      {
        projectId,
        // Note: We do NOT provide credentials for emulator
        // The emulator does not require authentication
      },
      `auth-helper-${Date.now()}`
    );

    this.auth = admin.auth(this.app);

    console.log(`✓ AuthHelper initialized with emulator at ${authEmulatorHost}`);
  }

  /**
   * Create a test user and return a valid Firebase ID token
   * @param uid User ID (should match test session userID)
   * @param claims Optional custom claims to add to the token
   * @returns ID token string that can be used in Authorization: Bearer header
   */
  async createUserAndGetToken(uid: string, claims: Record<string, unknown> = {}): Promise<string> {
    try {
      // Try to create the user (will fail if already exists, which is ok)
      await this.auth
        .createUser({
          uid,
          email: `${uid}@test.example.com`,
          emailVerified: true,
        })
        .catch((err) => {
          // User already exists - this is fine in tests
          if (err.code === 'auth/uid-already-exists') {
            console.log(`ℹ User ${uid} already exists in emulator`);
          } else {
            throw err;
          }
        });

      // Generate a custom token (first step of OAuth flow)
      const customToken = await this.auth.createCustomToken(uid, claims);

      // Exchange custom token for ID token via emulator REST API
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

      const data = (await response.json()) as {
        idToken: string;
      };
      return data.idToken;
    } catch (error) {
      console.error(`Failed to create token for user ${uid}:`, error);
      throw error;
    }
  }

  /**
   * Delete a test user
   * @param uid User ID to delete
   */
  async deleteUser(uid: string): Promise<void> {
    try {
      await this.auth.deleteUser(uid);
      console.log(`✓ Deleted test user ${uid}`);
    } catch (error) {
      console.error(`Failed to delete user ${uid}:`, error);
      // Don't throw - cleanup errors shouldn't fail tests
    }
  }

  /**
   * Cleanup: delete all created users and shutdown the app
   * Note: Full emulator cleanup happens when start-emulators.sh script stops
   */
  async cleanup(): Promise<void> {
    try {
      await admin.app(this.app.name).delete();
      console.log('✓ AuthHelper cleaned up');
    } catch (error) {
      console.error('Failed to cleanup AuthHelper:', error);
    }
  }
}
