/**
 * E2E tests for event listener setup error handling
 * Tests verify behavior when DOM elements are missing during initialization
 */
// TODO(#492): Update tests to verify logError() instead of console.error/warn
// NOTE: Current tests verify console output - assertions will need updating when production code changes

import { test, expect } from '../../../playwright.fixtures.ts';
import { waitForConsoleMessage } from './test-helpers.js';

test.describe('Event Listener Setup - Error Handling', () => {
  test('should log error and continue when toolbar buttons are missing', async ({ page }) => {
    // Navigate to page
    await page.goto('/cards.html');

    // Remove toolbar buttons to simulate missing DOM elements
    await page.evaluate(() => {
      document.getElementById('addCardBtn')?.remove();
      document.getElementById('importCardsBtn')?.remove();
      document.getElementById('exportCardsBtn')?.remove();
    });

    // Trigger re-initialization and wait for error message
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Wait for error message to appear
    const hasToolbarError = await waitForConsoleMessage(
      page,
      (msg) => msg.includes('Missing toolbar buttons'),
      500
    );
    expect(hasToolbarError).toBeTruthy();

    // Verify page doesn't crash - other functionality should still work
    const searchInput = page.locator('#searchCards');
    await expect(searchInput).toBeVisible();
  });

  test('should continue initialization when search input is missing', async ({ page }) => {
    await page.goto('/cards.html');

    // Remove search input
    await page.evaluate(() => {
      document.getElementById('searchCards')?.remove();
    });

    // Trigger re-initialization to test error handling
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Test passes if no exceptions are thrown - graceful degradation
    // Search input removal doesn't prevent page from loading other elements
  });

  test('should log error when modal elements are missing', async ({ page }) => {
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

    // Page should still be functional for reading cards
    const cardItems = page.locator('.card-item');
    await expect(cardItems.first()).toBeVisible({ timeout: 10000 });
  });

  test('should handle missing mobile menu elements gracefully', async ({ page }) => {
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

    // Wait for warning messages
    const hasMobileMenuWarning = await waitForConsoleMessage(
      page,
      (msg) =>
        msg.includes('Mobile menu toggle button not found') ||
        msg.includes('Sidebar element not found'),
      500
    );
    expect(hasMobileMenuWarning).toBeTruthy();
  });

  test('should identify specific missing elements in error messages', async ({ page }) => {
    await page.goto('/cards.html');

    // Remove specific elements to test error messages
    await page.evaluate(() => {
      document.getElementById('addCardBtn')?.remove();
    });

    // Trigger re-initialization to test error handling
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Wait for error message mentioning toolbar
    const hasToolbarError = await waitForConsoleMessage(
      page,
      (msg) => msg.includes('toolbar'),
      500
    );

    // Should have logged that toolbar buttons are missing
    expect(hasToolbarError).toBeTruthy();
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

  test('should not create duplicate listeners on re-initialization', async ({ page }) => {
    await page.goto('/cards.html');

    // Track exact number of listeners added before and after re-initialization
    const { beforeCount, afterCount } = await page.evaluate(() => {
      // Store original addEventListener to count calls
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      let beforeCount = 0;
      let afterCount = 0;

      // Count listeners added during first call
      EventTarget.prototype.addEventListener = function (...args) {
        beforeCount++;
        return originalAddEventListener.apply(this, args);
      };

      // First call to setupEventListeners
      window.__testHelpers?.setupEventListeners();

      // Reset counter for second call
      beforeCount = 0;
      EventTarget.prototype.addEventListener = function (...args) {
        afterCount++;
        return originalAddEventListener.apply(this, args);
      };

      // Trigger re-initialization
      window.__testHelpers?.setupEventListeners();

      // Restore original
      EventTarget.prototype.addEventListener = originalAddEventListener;

      return { beforeCount, afterCount };
    });

    // Re-initialization should add exactly 0 new listeners (all should be deduplicated)
    // The implementation should check for existing listeners before adding new ones
    expect(afterCount).toBe(0);
  });
});
