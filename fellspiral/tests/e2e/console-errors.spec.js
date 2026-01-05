/**
 * Console Errors Test
 * Ensures no console errors appear during normal page load and usage
 */

import { test, expect } from '../../../playwright.fixtures.ts';

// Only run against emulator
const isEmulatorMode = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

test.describe('Console Errors', () => {
  test.skip(!isEmulatorMode, 'Console error tests only run against emulator');

  test('should have no console errors on page load', async ({ page }) => {
    const consoleErrors = [];
    const consoleWarnings = [];

    // Capture console errors and warnings
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    // Capture page errors
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page error: ${error.message}`);
    });

    // Navigate to cards page
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for cards to load
    await page.waitForTimeout(3000);

    // Filter out known benign warnings
    const filteredErrors = consoleErrors.filter((error) => {
      // Ignore favicon 404 (not a real error)
      if (error.includes('favicon.ico')) return false;

      // Ignore Vite HMR connection messages in dev mode
      if (error.includes('[vite]')) return false;

      // Ignore storage access messages (browser feature, not an error)
      if (error.includes('Storage access')) return false;

      return true;
    });

    const filteredWarnings = consoleWarnings.filter((warning) => {
      // Ignore Vite dev server warnings
      if (warning.includes('[vite]')) return false;

      // Ignore layout warnings (performance hint, not a functional issue)
      if (warning.includes('Layout was forced')) return false;

      return true;
    });

    // Assert no errors
    if (filteredErrors.length > 0) {
      console.log('Console errors found:', filteredErrors);
    }
    expect(filteredErrors).toHaveLength(0);

    // Warnings are allowed but we log them for visibility
    if (filteredWarnings.length > 0) {
      console.log('Console warnings (non-blocking):', filteredWarnings);
    }
  });

  test('should have no console errors after signing in', async ({ page, authEmulator }) => {
    const consoleErrors = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page error: ${error.message}`);
    });

    // Navigate to cards page
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Clear any errors from initial load
    consoleErrors.length = 0;

    // Sign in
    const email = `console-test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Wait for auth state to propagate
    await page.waitForTimeout(2000);

    // Filter out benign errors
    const filteredErrors = consoleErrors.filter((error) => {
      if (error.includes('favicon.ico')) return false;
      if (error.includes('[vite]')) return false;
      if (error.includes('Storage access')) return false;
      return true;
    });

    // Assert no errors during sign-in
    if (filteredErrors.length > 0) {
      console.log('Console errors after sign-in:', filteredErrors);
    }
    expect(filteredErrors).toHaveLength(0);
  });

  test('should have no console errors during card operations', async ({ page, authEmulator }) => {
    const consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page error: ${error.message}`);
    });

    // Navigate and sign in
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    const email = `card-ops-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(2000);

    // Clear errors from setup
    consoleErrors.length = 0;

    // Perform card operations
    // 1. Open Add Card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal', { state: 'visible', timeout: 5000 });

    // 2. Close modal
    await page.click('[data-action="cancel"]');
    await page.waitForSelector('#cardEditorModal', { state: 'hidden', timeout: 5000 });

    // 3. Use search (if available)
    const searchInput = page.locator('input[type="search"]');
    if ((await searchInput.count()) > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await searchInput.clear();
    }

    // Wait a bit for any async errors
    await page.waitForTimeout(1000);

    // Filter out benign errors
    const filteredErrors = consoleErrors.filter((error) => {
      if (error.includes('favicon.ico')) return false;
      if (error.includes('[vite]')) return false;
      if (error.includes('Storage access')) return false;
      return true;
    });

    // Assert no errors during operations
    if (filteredErrors.length > 0) {
      console.log('Console errors during card operations:', filteredErrors);
    }
    expect(filteredErrors).toHaveLength(0);
  });
});
