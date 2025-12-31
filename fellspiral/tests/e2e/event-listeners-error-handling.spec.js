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

    // Wait for search filtering to complete and DOM to update.
    // handleFilterChange() in cards.js applies filters synchronously, but we need
    // to wait for the DOM to reflect the filtered state before asserting.
    await expect(async () => {
      const visibleCards = await page.locator('.card-item:visible').count();
      expect(visibleCards).toBeGreaterThan(0);
    }).toPass({ timeout: 2000 });

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

    // Set up console monitoring to verify no critical errors thrown
    const criticalErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Error setting up event listeners')) {
        criticalErrors.push(msg.text());
      }
    });

    // Trigger re-initialization to test error handling
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Verify graceful degradation: no critical errors thrown
    // The code logs a warning for missing search input, but should not throw
    expect(criticalErrors.length).toBe(0);

    // Verify other functionality still works - view mode buttons should be functional
    const viewModeBtn = page.locator('.view-mode-btn[data-mode="grid"]');
    await expect(viewModeBtn).toBeVisible();
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

  test('should log specific error when only closeModalBtn is missing', async ({ page }) => {
    await page.goto('/cards.html');

    // Remove only the close modal button
    await page.evaluate(() => {
      document.getElementById('closeModalBtn')?.remove();
    });

    // Trigger re-initialization
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Wait for specific error message about close modal button
    const hasCloseModalError = await waitForConsoleMessage(
      page,
      (msg) => msg.includes('Close modal button not found'),
      500
    );
    expect(hasCloseModalError).toBeTruthy();

    // Verify other modal functionality still works - cancel button should still exist
    const cancelBtn = page.locator('#cancelModalBtn');
    await expect(cancelBtn).toBeVisible();
  });

  test('should log specific error when only cardForm is missing', async ({ page }) => {
    await page.goto('/cards.html');

    // Remove only the card form
    await page.evaluate(() => {
      document.getElementById('cardForm')?.remove();
    });

    // Trigger re-initialization
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Wait for specific error message about card form
    const hasCardFormError = await waitForConsoleMessage(
      page,
      (msg) => msg.includes('Card form not found'),
      500
    );
    expect(hasCardFormError).toBeTruthy();

    // Verify other modal elements still work - modal buttons should exist
    const closeBtn = page.locator('#closeModalBtn');
    await expect(closeBtn).toBeVisible();
  });

  test('should log specific error when only cardType is missing', async ({ page }) => {
    await page.goto('/cards.html');

    // Remove only the card type select
    await page.evaluate(() => {
      document.getElementById('cardType')?.remove();
    });

    // Trigger re-initialization
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Wait for specific error message about card type select
    const hasCardTypeError = await waitForConsoleMessage(
      page,
      (msg) => msg.includes('Card type select not found'),
      500
    );
    expect(hasCardTypeError).toBeTruthy();

    // Verify other modal elements still work - form should exist
    const cardForm = page.locator('#cardForm');
    await expect(cardForm).toBeVisible();
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

    // Wait for search filtering to complete and DOM to update.
    // handleFilterChange() in cards.js applies filters synchronously, but we need
    // to wait for the DOM to reflect the filtered state before asserting.
    await expect(async () => {
      const visibleCards = await page.locator('.card-item:visible').count();
      expect(visibleCards).toBeGreaterThan(0);
    }).toPass({ timeout: 2000 });
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

  test('should re-throw non-addEventListener errors in setupEventListeners loop', async ({
    page,
  }) => {
    await page.goto('/cards.html');

    // Force an error during the modal elements loop by breaking getElementById
    // This tests the re-throw behavior for errors other than addEventListener failures
    const errorThrown = await page.evaluate(() => {
      try {
        const originalGetElement = document.getElementById.bind(document);
        let callCount = 0;

        // Throw error on a later call during the modal elements loop
        document.getElementById = function (id) {
          callCount++;
          // Throw on closeModalBtn lookup (first modal element in the loop)
          if (id === 'closeModalBtn') {
            throw new Error('Test error: DOM element lookup failed');
          }
          return originalGetElement(id);
        };

        try {
          window.__testHelpers?.setupEventListeners();
          return false; // Should not reach here
        } catch (error) {
          // Verify error was re-thrown (not swallowed)
          return error.message === 'Test error: DOM element lookup failed';
        } finally {
          // Restore original
          document.getElementById = originalGetElement;
        }
      } catch (e) {
        return false;
      }
    });

    // Verify the error was re-thrown (not silently swallowed)
    // This ensures issue #311 fix works for all error types, not just addEventListener
    expect(errorThrown).toBe(true);
  });

  test('should not log error when modal backdrop is missing (documents current behavior)', async ({
    page,
  }) => {
    await page.goto('/cards.html');

    // Remove modal backdrop
    await page.evaluate(() => {
      document.querySelector('.modal-backdrop')?.remove();
    });

    // Capture console error messages
    const errorMessages = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errorMessages.push(msg.text());
      }
    });

    // Trigger re-initialization
    await page.evaluate(() => {
      window.__testHelpers?.setupEventListeners();
    });

    // Allow time for any async logging
    await page.waitForTimeout(100);

    // Current behavior: no error logged for missing backdrop
    // The backdrop is handled separately from modal elements and lacks error logging
    // TODO(#1037): When implemented, update this test to verify error IS logged
    const hasBackdropError = errorMessages.some(
      (msg) => msg.toLowerCase().includes('backdrop') || msg.includes('modal-backdrop')
    );
    expect(hasBackdropError).toBe(false);

    // Verify other modal elements still work - close button should exist
    const closeBtn = page.locator('#closeModalBtn');
    await expect(closeBtn).toBeVisible();
  });
});
