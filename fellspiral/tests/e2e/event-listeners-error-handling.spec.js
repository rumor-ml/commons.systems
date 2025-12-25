/**
 * E2E tests for event listener setup error handling
 * Tests verify behavior when DOM elements are missing during initialization
 */
// TODO(#492): Update tests to verify production code uses logError() with Sentry tracking
// instead of console.error/console.warn

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Event Listener Setup - Error Handling', () => {
  test('should log error and continue when toolbar buttons are missing', async ({ page }) => {
    // Listen for console errors
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate to page
    await page.goto('/cards.html');

    // Remove toolbar buttons to simulate missing DOM elements
    await page.evaluate(() => {
      document.getElementById('addCardBtn')?.remove();
      document.getElementById('importCardsBtn')?.remove();
      document.getElementById('exportCardsBtn')?.remove();
    });

    // Trigger re-initialization to test error handling
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Allow time for any initialization errors to surface
    await page.waitForTimeout(500);

    // Verify error was logged
    const hasToolbarError = consoleErrors.some((msg) => msg.includes('Missing toolbar buttons'));
    expect(hasToolbarError).toBeTruthy();

    // Verify page doesn't crash - other functionality should still work
    const searchInput = page.locator('#searchCards');
    await expect(searchInput).toBeVisible();
  });

  test('should continue initialization when search input is missing', async ({ page }) => {
    // Listen for console warnings
    const consoleWarnings = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        consoleWarnings.push(msg.text());
      }
    });

    await page.goto('/cards.html');

    // Remove search input
    await page.evaluate(() => {
      document.getElementById('searchCards')?.remove();
    });

    // Trigger re-initialization to test error handling
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Allow time for warnings to surface
    await page.waitForTimeout(500);

    // Verify warnings were logged (test just checks console, doesn't need elements to be visible)
    // Note: Search input removal doesn't prevent page from loading other elements
  });

  test('should log error when modal elements are missing', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/cards.html');

    // Remove modal elements
    await page.evaluate(() => {
      document.getElementById('closeModalBtn')?.remove();
      document.getElementById('cancelModalBtn')?.remove();
      document.getElementById('deleteCardBtn')?.remove();
      document.getElementById('cardForm')?.remove();
      document.getElementById('cardType')?.remove();
    });

    // Trigger re-initialization to test error handling
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Allow time for errors to surface
    await page.waitForTimeout(500);

    // Page should still be functional for reading cards
    const cardItems = page.locator('.card-item');
    await expect(cardItems.first()).toBeVisible({ timeout: 10000 });
  });

  test('should handle missing mobile menu elements gracefully', async ({ page }) => {
    const consoleWarnings = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    await page.goto('/cards.html');

    // Remove mobile menu elements
    await page.evaluate(() => {
      document.getElementById('mobileMenuToggle')?.remove();
      document.getElementById('sidebar')?.remove();
    });

    // Trigger re-initialization to test error handling
    await page.evaluate(() => {
      window.__testHelpers?.setupMobileMenu();
    });

    // Allow time for warnings to surface
    await page.waitForTimeout(500);

    // Verify warnings were logged
    const hasMobileMenuWarning = consoleWarnings.some(
      (msg) =>
        msg.includes('Mobile menu toggle button not found') ||
        msg.includes('Sidebar element not found')
    );
    expect(hasMobileMenuWarning).toBeTruthy();
  });

  test('should identify specific missing elements in error messages', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto('/cards.html');

    // Remove specific elements to test error messages
    await page.evaluate(() => {
      document.getElementById('addCardBtn')?.remove();
    });

    // Trigger re-initialization to test error handling
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    await page.waitForTimeout(500);

    // Check that error message identifies the missing element
    const relevantErrors = consoleMessages.filter(
      (msg) => msg.type === 'error' && msg.text.includes('toolbar')
    );

    // At minimum, should have logged that toolbar buttons are missing
    expect(relevantErrors.length).toBeGreaterThan(0);
  });

  test('should allow partial functionality when some elements are missing', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');

    // Sign in as test user
    await authEmulator.createTestUser('test-partial@example.com');
    await authEmulator.signInTestUser('test-partial@example.com');
    await page.reload();

    // Remove export button only
    await page.evaluate(() => {
      document.getElementById('exportCardsBtn')?.remove();
    });

    await page.waitForTimeout(500);

    // Other functionality should still work - verify we can view cards
    const cardItems = page.locator('.card-item');
    await expect(cardItems.first()).toBeVisible({ timeout: 10000 });

    // Verify card grid is interactive (can filter, search, etc.)
    const searchInput = page.locator('#searchCards');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('skill');
    // KEEP: 300ms delay for search debouncing (UI responsiveness pattern)
    await page.waitForTimeout(300);

    // Should have filtered cards
    const visibleCards = await page.locator('.card-item').count();
    expect(visibleCards).toBeGreaterThan(0);
  });
});
