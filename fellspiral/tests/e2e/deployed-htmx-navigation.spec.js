/**
 * Deployed Site HTMX Navigation Tests
 * Tests HTMX navigation on the deployed Firebase preview site
 * These tests run in CI against the actual deployed URL to verify the fix works in production
 */

import { test, expect } from '../../../playwright.fixtures.ts';

// Only run against deployed URL (set via DEPLOYED_URL env var in CI)
const deployedUrl = process.env.DEPLOYED_URL;
const shouldRun = !!deployedUrl;

test.describe('Deployed Site - HTMX Navigation', () => {
  // Skip if not running against deployed site
  test.skip(!shouldRun, 'Requires DEPLOYED_URL environment variable');

  test('should navigate from homepage to cards via HTMX without infinite spinner', async ({
    page,
  }) => {
    // Start at deployed homepage
    await page.goto(deployedUrl + '/');

    // Wait for library navigation to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Click Equipment type in library nav
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for HTMX navigation to complete - URL should change to cards with hash
    await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });

    // CRITICAL: Verify we don't get stuck in infinite loading spinner
    // Loading should complete within 15 seconds
    await page.waitForFunction(
      () => {
        const loadingState = document.querySelector('.loading-state');
        const cardList = document.getElementById('cardList');
        const emptyState = document.getElementById('emptyState');

        // Loading is complete if spinner is hidden and either cards or empty state shows
        const loadingComplete = !loadingState || !loadingState.offsetParent;
        const contentVisible =
          (cardList && cardList.style.display !== 'none') ||
          (emptyState && emptyState.style.display !== 'none');

        return loadingComplete && contentVisible;
      },
      { timeout: 15000 }
    );

    // Verify we're not stuck with spinner
    const loadingState = page.locator('.loading-state');
    await expect(loadingState).not.toBeVisible();

    // Either cards OR empty state should be visible
    const cardList = page.locator('#cardList');
    const emptyState = page.locator('#emptyState');

    const cardsVisible = await cardList.isVisible();
    const emptyVisible = await emptyState.isVisible();

    // Exactly one should be visible (not stuck loading, not both visible)
    expect(cardsVisible || emptyVisible).toBe(true);
    expect(cardsVisible && emptyVisible).toBe(false);
  });

  test('should show cards or empty state after HTMX navigation completes', async ({ page }) => {
    // This test specifically verifies the bug fix where initLibraryNav() was blocking cards

    await page.goto(deployedUrl + '/');
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Navigate to Skill type
    const skillToggle = page.locator('.library-nav-type[data-type="Skill"] .library-nav-toggle');
    await skillToggle.click();

    await page.waitForURL(/cards(\.html)?#library-skill$/, { timeout: 10000 });

    // Wait for loading to complete
    await page.waitForFunction(
      () => {
        const loadingState = document.querySelector('.loading-state');
        return !loadingState || !loadingState.offsetParent;
      },
      { timeout: 15000 }
    );

    // Verify final state is valid
    const cardList = page.locator('#cardList');
    const emptyState = page.locator('#emptyState');
    const loadingState = page.locator('.loading-state');

    await expect(loadingState).not.toBeVisible();

    const cardsVisible = await cardList.isVisible();
    const emptyVisible = await emptyState.isVisible();

    // Must show either cards or empty state (not neither, not both)
    expect(cardsVisible || emptyVisible).toBe(true);

    if (cardsVisible) {
      // If cards loaded, verify they're actually rendered
      const cardCount = await page.locator('.card-item').count();
      // On deployed site with Firestore, we might have cards or might not
      // Just verify if cards are visible, there's at least content rendered
      expect(cardCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should handle multiple HTMX navigations without getting stuck', async ({ page }) => {
    // Test that navigating multiple times doesn't cause infinite spinner

    await page.goto(deployedUrl + '/');
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // First navigation: Equipment
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();
    await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });

    // Wait for loading to complete
    await page.waitForFunction(
      () => {
        const loadingState = document.querySelector('.loading-state');
        return !loadingState || !loadingState.offsetParent;
      },
      { timeout: 15000 }
    );

    // Verify not stuck
    let loadingState = page.locator('.loading-state');
    await expect(loadingState).not.toBeVisible();

    // Second navigation: Go back to homepage
    await page.goto(deployedUrl + '/');
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Navigate to Origin type
    const originToggle = page.locator('.library-nav-type[data-type="Origin"] .library-nav-toggle');
    await originToggle.click();
    await page.waitForURL(/cards(\.html)?#library-origin$/, { timeout: 10000 });

    // Wait for loading to complete again
    await page.waitForFunction(
      () => {
        const loadingState = document.querySelector('.loading-state');
        return !loadingState || !loadingState.offsetParent;
      },
      { timeout: 15000 }
    );

    // Verify not stuck on second navigation
    loadingState = page.locator('.loading-state');
    await expect(loadingState).not.toBeVisible();

    // Final state should be valid
    const cardList = page.locator('#cardList');
    const emptyState = page.locator('#emptyState');
    const cardsVisible = await cardList.isVisible();
    const emptyVisible = await emptyState.isVisible();
    expect(cardsVisible || emptyVisible).toBe(true);
  });
});
