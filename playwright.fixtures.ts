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
    const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
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
      // Sign in via emulator API
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

      // Set auth state in page context (simulate Firebase auth state)
      await page.evaluate((authData) => {
        const authUser = {
          uid: authData.localId,
          email: authData.email,
          emailVerified: authData.emailVerified || false,
          displayName: authData.displayName || null,
          photoURL: authData.photoUrl || null,
        };

        // Set in localStorage (Firebase auth uses this)
        const authKey = `firebase:authUser:${authData.apiKey}:[DEFAULT]`;
        localStorage.setItem(authKey, JSON.stringify(authUser));

        // Trigger storage event to notify auth listeners
        window.dispatchEvent(new StorageEvent('storage'));
      }, data);

      await page.reload();
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
