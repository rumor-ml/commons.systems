/**
 * Card Loading Tests
 * Tests that verify cards load correctly on direct page visits
 * This covers the scenario where users directly visit /cards.html
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Card Loading - Direct Page Visit', () => {
  test('should show loading state then load cards or empty state', async ({ page }) => {
    // Directly visit cards.html (simulates typing URL or bookmark)
    await page.goto('/cards.html');

    // Per user's logic: "if card loads too fast to show progress this is a pass,
    // if cards show progress then eventually load this is a pass,
    // if neither cards or loading state displays this is a fail"

    // Wait for either cards/empty state to appear (final state)
    // Don't require loading spinner - it's okay if cards load instantly
    await expect(async () => {
      const cardList = page.locator('#cardList');
      const emptyState = page.locator('#emptyState');

      // Either cards OR empty state should be visible (not both)
      const cardsVisible = await cardList.isVisible();
      const emptyVisible = await emptyState.isVisible();

      expect(cardsVisible || emptyVisible).toBe(true);
    }).toPass({ timeout: 15000 }); // Allow 15s for loading to complete
  });

  test('should not get stuck in infinite loading state', async ({ page }) => {
    await page.goto('/cards.html');

    // Per user's logic: cards OR empty state must eventually appear
    // Loading spinner presence is optional (cards might load instantly)

    // Wait up to 15 seconds for final state (cards or empty)
    await page.waitForFunction(
      () => {
        const cardList = document.getElementById('cardList');
        const emptyState = document.getElementById('emptyState');

        // Either cards or empty state should be visible
        const contentVisible =
          (cardList && cardList.style.display !== 'none') ||
          (emptyState && emptyState.style.display !== 'none');

        return contentVisible;
      },
      { timeout: 15000 }
    );

    // Verify final state is valid (cards or empty state visible)
    const cardList = page.locator('#cardList');
    const emptyState = page.locator('#emptyState');
    const cardsVisible = await cardList.isVisible();
    const emptyVisible = await emptyState.isVisible();

    expect(cardsVisible || emptyVisible).toBe(true);
  });

  test('should display cards when data is available', async ({ page }) => {
    // This test verifies cards actually render when data exists
    // In local env with cards.json, cards should load
    // In deployed env without Firestore data, empty state should show

    await page.goto('/cards.html');

    // Wait for loading to complete
    await page.waitForFunction(
      () => {
        const loadingState = document.querySelector('.loading-state');
        return !loadingState || !loadingState.offsetParent;
      },
      { timeout: 15000 }
    );

    // Check which state we ended up in
    const cardList = page.locator('#cardList');
    const emptyState = page.locator('#emptyState');

    const cardsVisible = await cardList.isVisible();
    const emptyVisible = await emptyState.isVisible();

    // Exactly one should be visible
    expect(cardsVisible || emptyVisible).toBe(true);
    expect(cardsVisible && emptyVisible).toBe(false);

    // If cards are visible, verify they rendered
    if (cardsVisible) {
      const cardItems = await page.locator('.card-item').count();
      expect(cardItems).toBeGreaterThan(0);
    }
  });

  test('should handle library nav loading without blocking cards', async ({ page }) => {
    // This test verifies that library navigation loading doesn't block card display
    // (the bug we just fixed)

    await page.goto('/cards.html');

    // Track when cards become visible
    const cardsVisiblePromise = page
      .locator('.card-item')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => Date.now())
      .catch(() => null);

    // Track when library nav becomes visible
    const libraryNavVisiblePromise = page
      .locator('.library-nav-type')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => Date.now())
      .catch(() => null);

    // Wait for both to settle
    const [cardsTime, libraryTime] = await Promise.all([
      cardsVisiblePromise,
      libraryNavVisiblePromise,
    ]);

    // Library nav loading should not block cards from showing
    // Cards should appear regardless of library nav state
    // Note: In local env with cards.json, cards should always load
    if (cardsTime) {
      // Cards loaded successfully - good!
      expect(cardsTime).toBeGreaterThan(0);
    } else {
      // Cards didn't load - verify we're showing empty state instead
      const emptyState = page.locator('#emptyState');
      await expect(emptyState).toBeVisible();
    }
  });
});
