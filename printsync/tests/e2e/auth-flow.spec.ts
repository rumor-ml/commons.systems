import { test, expect } from '@playwright/test';

test.describe('@emulator-only Firebase Auth Flow', () => {
  let consoleErrors: string[] = [];
  let networkErrors: { url: string; status: number }[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    networkErrors = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Capture page errors
    page.on('pageerror', (error) => {
      consoleErrors.push(`Uncaught exception: ${error.message}`);
    });

    // Capture network errors (excluding 301/302 redirects and 304 not modified)
    page.on('response', (response) => {
      if (
        !response.ok() &&
        response.status() !== 304 &&
        response.status() !== 301 &&
        response.status() !== 302
      ) {
        networkErrors.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });
  });

  test('should initialize auth without console errors', async ({ page }) => {
    await page.goto('/');

    // Wait for auth to complete by checking for firebase_token cookie
    // This avoids race conditions with the auth-ready event
    await page.waitForFunction(
      () => {
        return document.cookie.includes('firebase_token=');
      },
      { timeout: 15000 }
    );

    // Auth succeeded if we have a token
    const cookies = await page.context().cookies();
    const firebaseToken = cookies.find((c) => c.name === 'firebase_token');
    expect(firebaseToken).toBeDefined();
    expect(firebaseToken?.value.length).toBeGreaterThan(20);

    // Verify no console errors during auth initialization
    const authErrors = consoleErrors.filter(
      (err) => err.includes('Firebase') || err.includes('auth') || err.includes('Auth')
    );
    expect(authErrors, `Auth-related console errors:\n${authErrors.join('\n')}`).toEqual([]);

    // Verify no network errors
    expect(networkErrors, `Network errors:\n${JSON.stringify(networkErrors, null, 2)}`).toEqual([]);
  });

  test('should set firebase_token cookie after auth', async ({ page }) => {
    await page.goto('/');

    // Wait for auth completion
    await page.waitForFunction(() => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        document.addEventListener(
          'auth-ready',
          () => {
            clearTimeout(timeout);
            resolve(true);
          },
          { once: true }
        );
      });
    });

    // Check cookie was set
    const cookies = await page.context().cookies();
    const firebaseToken = cookies.find((c) => c.name === 'firebase_token');

    expect(firebaseToken).toBeDefined();
    expect(firebaseToken?.value).toBeTruthy();
    expect(firebaseToken?.value.length).toBeGreaterThan(20); // JWT tokens are long
  });

  test('should load protected endpoints without 401 after auth', async ({ page }) => {
    await page.goto('/');

    // Wait for auth completion
    await page.waitForFunction(() => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        document.addEventListener(
          'auth-ready',
          () => {
            clearTimeout(timeout);
            resolve(true);
          },
          { once: true }
        );
      });
    });

    // Wait for sync history to load (should NOT get 401)
    await page.waitForSelector('#sync-history', { timeout: 5000 });

    // Verify no 401 errors occurred
    const unauthorizedErrors = networkErrors.filter((err) => err.status === 401);
    expect(
      unauthorizedErrors,
      `401 errors found:\n${JSON.stringify(unauthorizedErrors, null, 2)}`
    ).toEqual([]);

    // Verify no auth-related console errors
    expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
