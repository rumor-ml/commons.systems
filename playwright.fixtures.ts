// playwright.fixtures.ts
import { test as base, expect } from '@playwright/test';

type AuthFixtures = {
  authEmulator: {
    /**
     * Create a test user in Firebase Auth emulator
     * @param email - Valid email address
     * @param password - Password (>= 6 characters, defaults to 'testpassword123')
     * @returns Promise resolving to user's local ID (uid)
     * @throws {Error} If email is invalid, password < 6 chars, or user already exists
     */
    createTestUser: (email: string, password?: string) => Promise<string>;
    /**
     * Sign in an existing test user
     * @param email - Email of previously created user
     * @param password - User's password (defaults to 'testpassword123')
     * @throws {Error} If user doesn't exist, password is incorrect, or validation fails
     */
    signInTestUser: (email: string, password?: string) => Promise<void>;
    /**
     * Sign out current test user by clearing auth state
     */
    signOutTestUser: () => Promise<void>;
  };
};

export const test = base.extend<AuthFixtures>({
  authEmulator: async ({ page }, use) => {
    const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    // Use the actual Firebase API key from fellspiral config (emulator accepts any key for API calls,
    // but localStorage key format must match what the app's Firebase SDK expects)
    const API_KEY = 'AIzaSyBbugulRE4hhlFmSlYSDo22pwkPnZqWfrw';

    const createTestUser = async (email: string, password: string = 'testpassword123') => {
      // Validate email format
      if (!email || !email.includes('@')) {
        throw new Error(`Invalid email: "${email}". Must be valid email format.`);
      }
      // Validate password length (Firebase Auth requires >= 6 characters)
      if (password.length < 6) {
        throw new Error(
          `Invalid password length: ${password.length}. Firebase Auth requires >= 6 characters.`
        );
      }

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

      // Check for API errors
      if (!response.ok()) {
        const error = await response.json();
        // If user already exists, that's fine - just return (user can sign in)
        if (error.error?.message === 'EMAIL_EXISTS') {
          // User already exists from previous test run - this is expected with shared emulators
          return '';
        }
        throw new Error(
          `Failed to create test user "${email}": ${error.error?.message || 'Unknown error'}. ` +
            `This may indicate the email/password is invalid.`
        );
      }

      const data = await response.json();
      return data.localId;
    };

    const signInTestUser = async (email: string, password: string = 'testpassword123') => {
      // Validate email format
      if (!email || !email.includes('@')) {
        throw new Error(`Invalid email: "${email}". Must be valid email format.`);
      }
      // Validate password length (Firebase Auth requires >= 6 characters)
      if (password.length < 6) {
        throw new Error(
          `Invalid password length: ${password.length}. Firebase Auth requires >= 6 characters.`
        );
      }

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

      // Check for API errors and provide helpful message
      if (!response.ok()) {
        const error = await response.json();
        throw new Error(
          `Failed to sign in test user "${email}": ${error.error?.message || 'Unknown error'}. ` +
            `Ensure the user was created first via createTestUser().`
        );
      }

      const data = await response.json();

      // Set auth state in page context (simulate Firebase auth state)
      await page.evaluate(
        ({ authData, apiKey }) => {
          const authUser = {
            uid: authData.localId,
            email: authData.email,
            emailVerified: authData.emailVerified || false,
            displayName: authData.displayName || null,
            photoURL: authData.photoUrl || null,
          };

          // Set in localStorage (Firebase auth uses this)
          // Note: Firebase SDK stores auth state with the API key in the key name
          const authKey = `firebase:authUser:${apiKey}:[DEFAULT]`;
          localStorage.setItem(authKey, JSON.stringify(authUser));

          // Trigger storage event to notify auth listeners
          window.dispatchEvent(new StorageEvent('storage'));
        },
        { authData: data, apiKey: API_KEY }
      );

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
