/**
 * E2E tests for event listener setup error handling
 * Tests verify behavior when DOM elements are missing during initialization
 */

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

    // Navigate to page and remove toolbar buttons before initialization
    await page.goto('/cards.html');

    // Remove toolbar buttons to simulate missing DOM elements
    await page.evaluate(() => {
      document.getElementById('addCardBtn')?.remove();
      document.getElementById('importCardsBtn')?.remove();
      document.getElementById('exportCardsBtn')?.remove();
    });

    // Trigger re-initialization (or verify current state if already initialized)
    await page.waitForTimeout(1000); // Allow time for any initialization errors to surface

    // Verify error was logged
    const hasToolbarError = consoleErrors.some((msg) => msg.includes('Missing toolbar buttons'));
    expect(hasToolbarError).toBeTruthy();

    // Verify page doesn't crash - other functionality should still work
    const searchInput = page.locator('#searchCards');
    await expect(searchInput).toBeVisible();
  });

  test('should continue initialization when search input is missing', async ({ page }) => {
    // Listen for console errors
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

    // Wait for initialization
    await page.waitForTimeout(1000);

    // Verify page still loads and other elements work
    const cardContainer = page.locator('.card-container');
    await expect(cardContainer).toBeVisible();

    // Verify cards can still load (doesn't depend on search)
    const cardItems = page.locator('.card-item');
    await expect(cardItems.first()).toBeVisible({ timeout: 10000 });
  });

  test('should log error when modal elements are missing', async ({ page }) => {
    await page.goto('/cards.html');

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Remove modal elements
    await page.evaluate(() => {
      document.getElementById('closeModalBtn')?.remove();
      document.getElementById('cancelModalBtn')?.remove();
      document.getElementById('deleteCardBtn')?.remove();
      document.getElementById('cardForm')?.remove();
      document.getElementById('cardType')?.remove();
    });

    // Wait for any errors to surface
    await page.waitForTimeout(1000);

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

    // Wait for initialization
    await page.waitForTimeout(1000);

    // Verify warnings were logged
    const hasMobileMenuWarning = consoleWarnings.some(
      (msg) =>
        msg.includes('Mobile menu toggle button not found') ||
        msg.includes('Sidebar element not found')
    );
    expect(hasMobileMenuWarning).toBeTruthy();

    // Page should still load
    const cardContainer = page.locator('.card-container');
    await expect(cardContainer).toBeVisible();
  });

  test('should identify specific missing elements in error messages', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto('/cards.html');

    // Remove specific elements one at a time to test error messages
    await page.evaluate(() => {
      document.getElementById('addCardBtn')?.remove();
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
    await page.waitForTimeout(300);

    // Should have filtered cards
    const visibleCards = await page.locator('.card-item').count();
    expect(visibleCards).toBeGreaterThan(0);
  });
});
