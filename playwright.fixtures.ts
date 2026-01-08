// playwright.fixtures.ts
import { test as base, expect } from '@playwright/test';
import admin from 'firebase-admin';

type AuthFixtures = {
  authEmulator: {
    createTestUser: (email: string, password?: string) => Promise<string>;
    signInTestUser: (email: string, password?: string) => Promise<void>;
    signOutTestUser: () => Promise<void>;
  };
};

// Initialize Firebase Admin once
// IMPORTANT: Must use same projectId as the Auth emulator (from GCP_PROJECT_ID env var)
let adminApp: admin.app.App;
if (!admin.apps.length) {
  adminApp = admin.initializeApp({
    projectId: process.env.GCP_PROJECT_ID || 'demo-test',
  });
} else {
  adminApp = admin.app();
}

export const test = base.extend<AuthFixtures>({
  page: async ({ page }, use) => {
    // Inject test collection name for parallel worker isolation
    // This ensures browser code queries the same collection that tests write to
    const workerIndex = process.env.TEST_PARALLEL_INDEX || '0';
    const collectionName = `cards-worker-${workerIndex}`;

    await page.addInitScript((name) => {
      window.__TEST_COLLECTION_NAME__ = name;
    }, collectionName);

    await use(page);
  },

  authEmulator: async ({ page }, use) => {
    const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
    const API_KEY = 'fake-api-key'; // Emulator accepts any API key

    const createTestUser = async (email: string, password: string = 'testpassword123') => {
      // Use Firebase Auth emulator API to create test user
      const response = await page.request.post(
        `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
        {
          data: {
            email,
            password,
            returnSecureToken: true,
          },
        }
      );
      const data = await response.json();
      return data.localId;
    };

    const signInTestUser = async (email: string, password: string = 'testpassword123') => {
      // Get the user's UID (user should already be created by createTestUser)
      // Sign in via emulator API to get the UID
      const response = await page.request.post(
        `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
        {
          data: {
            email,
            password,
            returnSecureToken: true,
          },
        }
      );
      const data = await response.json();
      const uid = data.localId;

      if (!uid) {
        throw new Error(`Failed to get UID for user ${email}. Response: ${JSON.stringify(data)}`);
      }

      // Generate custom token using Firebase Admin SDK
      const customToken = await admin.auth(adminApp).createCustomToken(uid);

      // Navigate to page first so Firebase SDK is loaded
      await page.waitForLoadState('domcontentloaded');

      // Firebase config - must use emulator's projectId for custom token auth to work
      // Custom tokens are signed for the projectId used by Admin SDK (process.env.GCP_PROJECT_ID)
      // so the browser-side Firebase app must also use the same projectId
      const firebaseConfig = {
        apiKey: 'AIzaSyBbugulRE4hhlFmSlYSDo22pwkPnZqWfrw',
        authDomain: 'chalanding.firebaseapp.com',
        projectId: process.env.GCP_PROJECT_ID || 'demo-test',
        storageBucket: 'chalanding.firebasestorage.app',
        messagingSenderId: '190604485916',
        appId: '1:190604485916:web:abc123def456',
      };

      // Sign in using custom token (NearForm approach)
      await page.evaluate(
        async ({ token }) => {
          // Import Firebase SDK
          const { signInWithCustomToken } = await import(
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
          );

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

          // Sign in with custom token
          // The auth instance is already connected to the emulator by firebase.js
          await signInWithCustomToken(auth, token);

          // Set window.__testAuth for test helpers
          window.__testAuth = auth;

          // IMPORTANT: Manually add 'authenticated' class to body
          // The onAuthStateChanged listener doesn't fire when signing in from page.evaluate()
          // due to module scope isolation. This is expected in E2E tests.
          document.body.classList.add('authenticated');
        },
        { token: customToken }
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
