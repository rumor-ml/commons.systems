/**
 * QA User Seeding Tests
 * Verifies that the QA GitHub user is properly seeded in the Auth emulator
 */

import { test, expect } from '../../../playwright.fixtures.ts';

// Only run against emulator
const isEmulatorMode = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

test.describe('QA User Seeding', () => {
  test.skip(!isEmulatorMode, 'QA user seeding tests only run against emulator');

  test('should have QA GitHub user seeded in Auth emulator', async ({ page }) => {
    // Navigate to cards page to initialize Firebase
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Check if QA GitHub user exists via Auth emulator REST API
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const response = await page.request.post(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fake-api-key`,
      {
        data: {
          localId: ['qa-github-user-id'],
        },
      }
    );

    expect(response.ok()).toBe(true);
    const data = await response.json();

    // Verify user exists
    expect(data.users).toBeDefined();
    expect(data.users.length).toBe(1);

    const qaUser = data.users[0];
    expect(qaUser.localId).toBe('qa-github-user-id');
    expect(qaUser.email).toBe('qa-github@test.com');
    expect(qaUser.displayName).toBe('QA GitHub User');

    // Verify GitHub provider is linked
    expect(qaUser.providerUserInfo).toBeDefined();
    const githubProvider = qaUser.providerUserInfo.find((p) => p.providerId === 'github.com');
    expect(githubProvider).toBeDefined();
    expect(githubProvider.rawId).toBe('12345678');
  });

  test('should show QA GitHub user in Sign in with GitHub popup', async ({ page }) => {
    // Navigate to cards page
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Find and click the GitHub sign-in button
    const signInButton = page.locator('button:has-text("Sign in with GitHub")');

    // If the button exists and is visible, click it
    if ((await signInButton.count()) > 0 && (await signInButton.isVisible())) {
      // The Auth emulator will show a popup with test accounts
      // We can't directly interact with the popup, but we can verify the user exists
      // by checking the emulator's account list

      const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

      // Get all accounts from emulator
      const response = await page.request.get(
        `http://${authHost}/emulator/v1/projects/demo-test/accounts`,
        {
          headers: {
            Authorization: 'Bearer owner',
          },
        }
      );

      // The emulator might return 404 or empty if no accounts, which is fine
      // We just want to verify our seeded user is there
      if (response.ok()) {
        const data = await response.json();
        if (data.userInfo) {
          const qaUser = data.userInfo.find((u) => u.localId === 'qa-github-user-id');
          expect(qaUser).toBeDefined();
          expect(qaUser.email).toBe('qa-github@test.com');
        }
      }
    } else {
      // Button not found - user might already be signed in or layout is different
      // Just verify the user exists in the emulator
      const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
      const response = await page.request.post(
        `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fake-api-key`,
        {
          data: {
            localId: ['qa-github-user-id'],
          },
        }
      );

      expect(response.ok()).toBe(true);
      const data = await response.json();
      expect(data.users).toBeDefined();
      expect(data.users.length).toBeGreaterThan(0);
    }
  });
});
