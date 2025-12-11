import { test, expect } from '@playwright/test';

test.describe('Auth Initialization', () => {
  test('should load JavaScript modules with correct MIME types', async ({ page }) => {
    // Track network requests
    const requests: { url: string; contentType: string | null }[] = [];

    page.on('response', async (response) => {
      if (response.url().includes('.js')) {
        requests.push({
          url: response.url(),
          contentType: response.headers()['content-type'],
        });
      }
    });

    // Navigate to homepage
    await page.goto('/');

    // Wait for auth initialization
    await page.waitForTimeout(2000);

    // Verify auth-init.js was loaded with correct MIME type
    const authInitRequest = requests.find((r) => r.url.includes('auth-init.js'));
    expect(authInitRequest).toBeDefined();
    expect(authInitRequest?.contentType).toContain('application/javascript');

    // Verify firebase-config.js was loaded with correct MIME type
    const firebaseConfigRequest = requests.find((r) => r.url.includes('firebase-config.js'));
    expect(firebaseConfigRequest).toBeDefined();
    expect(firebaseConfigRequest?.contentType).toContain('application/javascript');
  });

  test('should initialize auth and set token cookie', async ({ page }) => {
    // Set up console message collector BEFORE navigation to avoid race condition
    const authMessages: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[Auth]')) {
        authMessages.push(msg.text());
      }
    });

    await page.goto('/');

    // Wait for auth to complete by checking for firebase_token cookie
    await page.waitForFunction(
      () => {
        return document.cookie.includes('firebase_token=');
      },
      { timeout: 15000 }
    );

    // Verify we saw the token sync message
    expect(authMessages.some((msg) => msg.includes('Token synced to cookie'))).toBe(true);

    // Verify firebase_token cookie is set
    const cookies = await page.context().cookies();
    const firebaseToken = cookies.find((c) => c.name === 'firebase_token');
    expect(firebaseToken).toBeDefined();
    expect(firebaseToken?.value).toBeTruthy();
  });

  test('should load sync history without 401 error after auth', async ({ page }) => {
    // Track failed requests
    const failedRequests: string[] = [];

    page.on('response', async (response) => {
      if (response.status() === 401) {
        failedRequests.push(response.url());
      }
    });

    await page.goto('/');

    // Wait for auth-ready event to fire
    await page.waitForTimeout(3000);

    // Verify no 401 errors occurred
    expect(failedRequests).toHaveLength(0);

    // Verify sync history loaded
    const syncHistory = page.locator('#sync-history');
    await expect(syncHistory).toBeVisible();

    // Should not show "Loading..." anymore
    await expect(syncHistory.locator('text=Loading...')).not.toBeVisible();
  });

  test('should handle missing auth gracefully in production', async ({ page }) => {
    // This test verifies behavior when Firebase auth is not available
    // Useful for production deployments without emulator

    // Block Firebase SDK loading
    await page.route('**/firebase-app-compat.js', (route) => route.abort());
    await page.route('**/firebase-auth-compat.js', (route) => route.abort());

    await page.goto('/');

    // Should dispatch auth-ready even on failure
    await page.waitForTimeout(3000);

    // Page should still render (degraded, but not broken)
    const main = page.locator('main');
    await expect(main).toBeVisible();
  });
});
