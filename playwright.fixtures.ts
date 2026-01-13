// playwright.fixtures.ts
import { test as base, expect } from '@playwright/test';
import admin from 'firebase-admin';

/**
 * Transient errors that should trigger retries
 */
const TRANSIENT_ERROR_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'ENOTFOUND',
  'socket hang up',
  'network timeout',
  'ETIMEDOUT',
];

/**
 * Check if an error is transient and should be retried
 */
function isTransientError(error: Error | string): boolean {
  const message = typeof error === 'string' ? error : error.message;
  return TRANSIENT_ERROR_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Execute an async operation with exponential backoff retry
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    operationName?: string;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 5000,
    operationName = 'operation',
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (!isTransientError(lastError) || attempt === maxAttempts) {
        throw lastError;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      console.warn(
        `[Auth Emulator] ${operationName} failed (attempt ${attempt}/${maxAttempts}): ${lastError.message}. ` +
          `Retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Branded type for User ID to provide semantic meaning and prevent mixing with plain strings.
 * @example
 * const userId: UserId = await createTestUser('test@example.com');
 * await signInTestUser(userId); // Type-safe - only accepts UserId
 */
type UserId = string & { readonly __brand: 'UserId' };

/**
 * Validate and create a UserId from a raw value
 * @param value - Raw value to validate (typically from API response)
 * @returns UserId if valid
 * @throws Error if value is not a valid Firebase Auth UID
 */
function createUserId(value: unknown): UserId {
  if (typeof value !== 'string' || !value) {
    throw new Error(`UserId must be a non-empty string, got: ${typeof value}`);
  }

  // Firebase UIDs are typically 28 characters alphanumeric
  if (!/^[a-zA-Z0-9]{20,}$/.test(value)) {
    throw new Error(`Invalid UserId format: ${value}`);
  }

  return value as UserId;
}

/**
 * Test fixtures for Firebase Authentication emulator operations.
 *
 * These fixtures provide helper methods for E2E tests to manage auth state.
 *
 * @remarks
 * **IMPORTANT: Usage order invariants**
 * - `createTestUser` must be called BEFORE `signInTestUser` for a given email
 * - `signInTestUser` requires the user to already exist in the emulator
 * - `signOutTestUser` has no preconditions
 *
 * TODO(#1360): Add runtime precondition enforcement for AuthFixtures usage order invariants
 *
 * @example
 * ```typescript
 * test('my test', async ({ page, authEmulator }) => {
 *   // 1. Create user first
 *   const userId = await authEmulator.createTestUser('test@example.com');
 *
 *   // 2. Sign in with the created user's ID
 *   await authEmulator.signInTestUser('test@example.com');
 *
 *   // 3. Perform test actions...
 *
 *   // 4. Sign out when done (optional)
 *   await authEmulator.signOutTestUser();
 * });
 * ```
 */
type AuthFixtures = {
  authEmulator: {
    /**
     * Creates a new test user in the Firebase Auth emulator.
     *
     * @param email - User email address (should be unique per test)
     * @param password - User password (default: 'testpassword123')
     * @returns Promise resolving to the user's UID
     *
     * @remarks
     * - Email format is not validated by this function
     * - Password requirements are not enforced in emulator mode
     * - The user is created but NOT signed in - call `signInTestUser` afterward
     *
     * @example
     * const userId = await authEmulator.createTestUser(`test-${Date.now()}@example.com`);
     */
    createTestUser: (email: string, password?: string) => Promise<UserId>;

    /**
     * Signs in a test user using the Firebase Auth emulator.
     *
     * @param email - Email of user to sign in
     * @param password - User password (default: 'testpassword123')
     * @returns Promise that resolves when sign-in completes and auth state propagates
     *
     * @precondition User must have been created with `createTestUser` first
     * @throws Error if user does not exist or credentials are invalid
     *
     * @remarks
     * - Uses custom token authentication via Firebase Admin SDK
     * - Waits for auth state to propagate to the page
     * - Sets `window.__testAuth` and adds 'authenticated' class to body
     *
     * @example
     * await authEmulator.createTestUser('test@example.com');
     * await authEmulator.signInTestUser('test@example.com');
     */
    signInTestUser: (email: string, password?: string) => Promise<void>;

    /**
     * Signs out the current test user by clearing auth state.
     *
     * @returns Promise that resolves when sign-out completes
     *
     * @remarks
     * - Clears all Firebase auth keys from localStorage
     * - Reloads the page to reset state
     * - Safe to call even if no user is signed in
     *
     * @example
     * await authEmulator.signOutTestUser();
     */
    signOutTestUser: () => Promise<void>;
  };
};

// Firebase Admin - lazy initialization to avoid module-level errors in smoke tests
// Smoke tests don't use authEmulator fixture, so they shouldn't trigger Admin SDK init
// IMPORTANT: Must use same projectId as the Auth emulator (from GCP_PROJECT_ID env var)
let adminApp: admin.app.App | null = null;

function getAdminApp(): admin.app.App {
  if (adminApp) {
    return adminApp;
  }

  // CRITICAL: Remove credentials file to use emulator without auth
  // CI sets GOOGLE_APPLICATION_CREDENTIALS which causes "Invalid credentials" errors
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('⚠️  Removing GOOGLE_APPLICATION_CREDENTIALS for emulator mode');
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  if (!admin.apps.length) {
    adminApp = admin.initializeApp({
      projectId: process.env.GCP_PROJECT_ID || 'demo-test',
    });
  } else {
    adminApp = admin.app();
  }

  return adminApp;
}

export const test = base.extend<AuthFixtures>({
  page: async ({ page }, use) => {
    // Inject test collection name for parallel worker isolation
    // This ensures browser code queries the same collection that tests write to
    // Playwright sets PLAYWRIGHT_WORKER_INDEX (0-based) for each worker
    const workerIndex =
      process.env.TEST_PARALLEL_INDEX || process.env.PLAYWRIGHT_WORKER_INDEX || '0';
    const collectionName = `cards-worker-${workerIndex}`;

    await page.addInitScript((name) => {
      window.__TEST_COLLECTION_NAME__ = name;
    }, collectionName);

    await use(page);
  },

  authEmulator: async ({ page }, use) => {
    const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
    const API_KEY = 'fake-api-key'; // Emulator accepts any API key

    const createTestUser = async (
      email: string,
      password: string = 'testpassword123'
    ): Promise<UserId> => {
      // Use Firebase Auth emulator API to create test user
      const response = await withRetry(
        () =>
          page.request.post(
            `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
            {
              data: {
                email,
                password,
                returnSecureToken: true,
              },
            }
          ),
        { operationName: 'createTestUser', maxAttempts: 3, baseDelayMs: 500 }
      );

      if (!response.ok()) {
        const errorBody = await response.text();
        throw new Error(`Failed to create test user: ${response.status()} - ${errorBody}`);
      }

      const data = await response.json();
      return createUserId(data.localId);
    };

    const signInTestUser = async (email: string, password: string = 'testpassword123') => {
      // Step 1: Call Auth emulator API (with retry)
      const response = await withRetry(
        () =>
          page.request.post(
            `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
            {
              data: {
                email,
                password,
                returnSecureToken: true,
              },
            }
          ),
        { operationName: 'signInTestUser (emulator API)', maxAttempts: 3, baseDelayMs: 500 }
      );

      if (!response.ok()) {
        const errorBody = await response.text();
        throw new Error(`Failed to sign in test user: ${response.status()} - ${errorBody}`);
      }

      const data = await response.json();

      try {
        var uid = createUserId(data.localId);
      } catch (error) {
        throw new Error(
          `Failed to get valid UID for user ${email}. ` +
            `Validation error: ${error.message}. ` +
            `Response: ${JSON.stringify(data)}`
        );
      }

      // Step 2: Generate custom token (with retry)
      // Use lazy initialization to avoid module-level errors in smoke tests
      const customToken = await withRetry(() => admin.auth(getAdminApp()).createCustomToken(uid), {
        operationName: 'createCustomToken',
        maxAttempts: 3,
        baseDelayMs: 500,
      });

      // Navigate to page first so Firebase SDK is loaded
      await page.waitForLoadState('domcontentloaded');

      // Step 3: Exchange token in browser (with retry via page.evaluate)
      // Note: We use the page's existing auth instance from firebase.js,
      // which is already configured with the correct projectId for the emulator
      await withRetry(
        async () => {
          await page.evaluate(
            async ({ token }) => {
              // Wait for auth to be initialized (event-driven with timeout)
              const waitForAuth = async (timeout = 10000) => {
                return new Promise((resolve, reject) => {
                  // Already ready?
                  if (window.auth) {
                    resolve(window.auth);
                    return;
                  }

                  // Set timeout
                  const timer = setTimeout(() => {
                    reject(new Error('Firebase init timeout after ' + timeout + 'ms'));
                  }, timeout);

                  // Wait for firebase:ready event
                  window.addEventListener(
                    'firebase:ready',
                    () => {
                      clearTimeout(timer);
                      resolve(window.auth);
                    },
                    { once: true }
                  );
                });
              };

              // Use the page's existing auth instance (from firebase.js)
              // The page already connects to the emulator, so we just need to sign in
              const auth = await waitForAuth();

              // CRITICAL FIX (Issue #244 infrastructure stability):
              // Use page's exposed signInWithCustomToken instead of importing from CDN
              // The page already has firebase/auth loaded and configured for emulator mode
              // firebase.js exposes signInWithCustomToken on window to avoid CDN timeouts
              if (!window.signInWithCustomToken) {
                throw new Error(
                  'signInWithCustomToken not available on window. ' +
                    'Ensure firebase.js loaded correctly.'
                );
              }

              // Sign in with custom token using page's loaded Firebase SDK
              // This avoids CDN network requests during tests which can cause timeouts
              await window.signInWithCustomToken(auth, token);

              // Set window.__testAuth for test helpers
              window.__testAuth = auth;

              // IMPORTANT: Manually add 'authenticated' class to body
              // The onAuthStateChanged listener doesn't fire when signing in from page.evaluate()
              // due to module scope isolation. This is expected in E2E tests.
              document.body.classList.add('authenticated');
            },
            { token: customToken }
          );
        },
        { operationName: 'signInWithCustomToken', maxAttempts: 3, baseDelayMs: 1000 }
      );

      // Wait for auth state to propagate and UI to update
      // Use event-driven wait instead of hard-coded timeout for better performance
      try {
        await page.waitForFunction(
          () => {
            return (
              window.auth?.currentUser != null && document.body.classList.contains('authenticated')
            );
          },
          { timeout: 5000 }
        );
      } catch (error) {
        // Debug: check what's happening if wait times out
        const bodyClasses = await page.evaluate(() => document.body.className);
        const authState = await page.evaluate(() => ({
          authExists: !!window.auth,
          testAuthExists: !!window.__testAuth,
          currentUser: !!window.auth?.currentUser,
          testCurrentUser: !!window.__testAuth?.currentUser,
          uid: window.auth?.currentUser?.uid || window.__testAuth?.currentUser?.uid,
        }));
        throw new Error(
          `Auth state failed to propagate within 5 seconds.\n` +
            `Body classes: ${bodyClasses}\n` +
            `Auth state: ${JSON.stringify(authState)}\n` +
            `Original error: ${error.message}`
        );
      }
    };

    const signOutTestUser = async () => {
      await page.evaluate(() => {
        // Clear all Firebase auth keys from localStorage
        const keys = Object.keys(localStorage);
        keys.forEach((key) => {
          if (key.startsWith('firebase:authUser:')) {
            localStorage.removeItem(key);
          }
        });
      });
      await page.reload();
    };

    await use({ createTestUser, signInTestUser, signOutTestUser });
  },
});

export { expect };
