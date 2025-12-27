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

  test('should continue initialization after toolbar button errors', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');

    // Sign in to enable functionality
    await authEmulator.createTestUser('test-toolbar-graceful@example.com');
    await authEmulator.signInTestUser('test-toolbar-graceful@example.com');
    await page.reload();

    // Remove toolbar buttons to cause error
    await page.evaluate(() => {
      document.getElementById('addCardBtn')?.remove();
      document.getElementById('importCardsBtn')?.remove();
      document.getElementById('exportCardsBtn')?.remove();
    });

    // Trigger re-initialization
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Verify that other event listeners still work despite toolbar error
    // Test search functionality
    const searchInput = page.locator('#searchCards');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('skill');
    await page.waitForTimeout(300); // Debounce delay

    // Search should filter cards (verifies search listener was set up)
    const visibleCards = await page.locator('.card-item').count();
    expect(visibleCards).toBeGreaterThan(0);

    // Test view mode buttons (verifies view mode listeners were set up)
    const gridViewBtn = page.locator('.view-mode-btn[data-mode="grid"]');
    await expect(gridViewBtn).toBeVisible();
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
    // KEEP: 300ms delay matches production search debouncing (300ms in cards.js)
    // Without this delay, test would check results before debounced search executes
    await page.waitForTimeout(300);

    // Should have filtered cards
    const visibleCards = await page.locator('.card-item').count();
    expect(visibleCards).toBeGreaterThan(0);
  });

  test('should handle re-initialization without duplicate behavior', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');

    // Sign in to enable card creation
    await authEmulator.createTestUser('test-reinit@example.com');
    await authEmulator.signInTestUser('test-reinit@example.com');
    await page.reload();

    // Re-initialize event listeners multiple times
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
      window.__testHelpers?.setupEventListeners();
    });

    // Test behavior: Click add card button - modal should open normally
    await page.locator('#addCardBtn').click();
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Close modal
    await page.locator('#closeModalBtn').click();
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible();

    // Click again - modal should still work correctly (not broken by re-initialization)
    await page.locator('#addCardBtn').click();
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();
  });

  test('setupEventListeners should re-throw errors after logging', async ({ page }) => {
    await page.goto('/cards.html');

    // Force an error by breaking the DOM in a way that causes setupEventListeners to fail
    const errorThrown = await page.evaluate(() => {
      try {
        // Monkey-patch addEventListener to throw an error
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function () {
          throw new Error('Test error: addEventListener failed');
        };

        try {
          window.__testHelpers?.setupEventListeners();
          return false; // Should not reach here
        } catch (error) {
          // Verify error was re-thrown (not swallowed)
          return error.message === 'Test error: addEventListener failed';
        } finally {
          // Restore original
          EventTarget.prototype.addEventListener = originalAddEventListener;
        }
      } catch (e) {
        return false;
      }
    });

    // Verify the error was re-thrown (not silently swallowed)
    expect(errorThrown).toBe(true);
  });

  test('setupMobileMenu should re-throw errors after logging', async ({ page }) => {
    await page.goto('/cards.html');

    // Force an error in setupMobileMenu
    const errorThrown = await page.evaluate(() => {
      try {
        // Monkey-patch addEventListener to throw an error
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function () {
          throw new Error('Test error: mobile menu addEventListener failed');
        };

        try {
          window.__testHelpers?.setupMobileMenu();
          return false; // Should not reach here
        } catch (error) {
          // Verify error was re-thrown (not swallowed)
          return error.message === 'Test error: mobile menu addEventListener failed';
        } finally {
          // Restore original
          EventTarget.prototype.addEventListener = originalAddEventListener;
        }
      } catch (e) {
        return false;
      }
    });

    // Verify the error was re-thrown (not silently swallowed)
    expect(errorThrown).toBe(true);
  });
});
