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

export const test = base.extend<AuthFixtures>({
  authEmulator: async ({ page }, use) => {
    const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
    const API_KEY = 'fake-api-key'; // Emulator accepts any API key

    // Initialize Firebase Admin SDK for creating custom tokens
    if (!admin.apps.length) {
      // CRITICAL: Delete GOOGLE_APPLICATION_CREDENTIALS when using emulator
      // In CI, this env var points to a service account key file. Firebase Admin SDK
      // tries to load it BEFORE checking if we're connecting to an emulator, causing
      // invalid custom tokens. The emulator doesn't need credentials.
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      }

      admin.initializeApp({
        projectId: 'demo-test',
      });
    }

    // Store console errors for test assertions
    const consoleErrors: string[] = [];

    // Capture console errors for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const errorText = msg.text();
        console.log(`[Browser Error] ${errorText}`);
        consoleErrors.push(errorText);
      }
      // Also capture card-related logs
      if (msg.text().includes('[Cards]')) {
        console.log(`[Browser] ${msg.text()}`);
      }
    });

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
      // Get user UID (need this to create custom token)
      let uid: string;
      try {
        const userRecord = await admin.auth().getUserByEmail(email);
        uid = userRecord.uid;
      } catch (error) {
        // User doesn't exist, create it first
        uid = await createTestUser(email, password);
      }

      // Create custom token using Admin SDK (works with emulator, no provider config needed)
      const customToken = await admin.auth().createCustomToken(uid);

      // Wait for Firebase SDK to be initialized in the page
      await page.waitForFunction(
        () => typeof (window as any).__signInWithCustomToken === 'function',
        { timeout: 15000 }
      );

      // Sign in using custom token via exposed helper function
      // This properly sets auth.currentUser for Firestore security rules
      const signInResult = await page.evaluate(async (token) => {
        try {
          const result = await (window as any).__signInWithCustomToken(token);
          return { success: true, uid: result.user.uid };
        } catch (error: any) {
          return { success: false, error: error?.message || String(error) };
        }
      }, customToken);

      if (!signInResult.success) {
        throw new Error(`Firebase sign-in failed for ${email}: ${signInResult.error}`);
      }

      // Wait for auth state to propagate
      await page.waitForFunction(
        () => {
          const auth = (window as any).__testAuth;
          return auth && auth.currentUser !== null;
        },
        { timeout: 10000 }
      );

      // Verify the authenticated class was added by auth state listener
      await page.waitForFunction(() => document.body.classList.contains('authenticated'), {
        timeout: 5000,
      });
    };

    const signOutTestUser = async () => {
      // Use Firebase SDK to sign out via the exposed helper
      await page.evaluate(async () => {
        if (typeof (window as any).__signOut === 'function') {
          await (window as any).__signOut();
        }
      });

      // Wait for auth state to update
      await page.waitForFunction(
        () => {
          const auth = (window as any).__testAuth;
          return auth && auth.currentUser === null;
        },
        { timeout: 5000 }
      );
    };

    await use({ createTestUser, signInTestUser, signOutTestUser });
  },
});

export { expect };
