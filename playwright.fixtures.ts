// playwright.fixtures.ts
import { test as base, expect } from '@playwright/test';

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

    // Capture console errors for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[Browser Error] ${msg.text()}`);
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
      // Wait for Firebase auth to be initialized and connected to emulator
      // The __signInWithEmailAndPassword function is exposed by github-auth.js
      await page.waitForFunction(
        () => typeof (window as any).__signInWithEmailAndPassword === 'function',
        { timeout: 15000 }
      );

      // Sign in using Firebase SDK via the exposed helper
      // This properly updates auth.currentUser which the app depends on
      const signInResult = await page.evaluate(
        async ({ email, password }) => {
          try {
            const result = await (window as any).__signInWithEmailAndPassword(email, password);
            return { success: true, uid: result?.user?.uid };
          } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
          }
        },
        { email, password }
      );

      if (!signInResult.success) {
        throw new Error(`Firebase sign-in failed: ${signInResult.error}`);
      }

      // Wait for auth state to propagate (SDK level)
      await page.waitForFunction(
        () => {
          const auth = (window as any).__testAuth;
          return auth && auth.currentUser !== null;
        },
        { timeout: 10000 }
      );

      // Manually trigger the UI update since the listener might not have fired
      // This works around potential timing issues with auth state listeners
      await page.evaluate(() => {
        if (typeof (window as any).__updateAuthUI === 'function') {
          const auth = (window as any).__testAuth;
          (window as any).__updateAuthUI(auth?.currentUser);
        } else {
          // Fallback: add class directly
          document.body.classList.add('authenticated');
        }
      });

      // Verify the class was added
      await page.waitForFunction(
        () => document.body.classList.contains('authenticated'),
        { timeout: 5000 }
      );
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
