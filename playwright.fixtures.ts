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

          // Use the page's existing auth instance (from firebase.js)
          // The page already connects to the emulator, so we just need to sign in
          const auth = window.auth;
          if (!auth) {
            throw new Error('window.auth not found - Firebase may not be initialized yet');
          }

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
      // Give extra time for the backup auth check (AUTH_RETRY_MS = 500ms)
      await page.waitForTimeout(1000);

      // Verify the authenticated class was added
      const hasAuthClass = await page.evaluate(() =>
        document.body.classList.contains('authenticated')
      );
      if (!hasAuthClass) {
        // Debug: check what's happening
        const bodyClasses = await page.evaluate(() => document.body.className);
        const authState = await page.evaluate(() => ({
          authExists: !!window.auth,
          testAuthExists: !!window.__testAuth,
          currentUser: !!window.auth?.currentUser,
          testCurrentUser: !!window.__testAuth?.currentUser,
          uid: window.auth?.currentUser?.uid || window.__testAuth?.currentUser?.uid,
        }));
        throw new Error(
          `Body 'authenticated' class not added after sign-in.\n` +
            `Body classes: ${bodyClasses}\n` +
            `Auth state: ${JSON.stringify(authState)}`
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
