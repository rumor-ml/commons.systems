/**
 * Debug test for deployed site
 * This test will help us understand what's happening on the deployed site
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Debug Deployed Site', () => {
  test('debug loading state on deployed site', async ({ page }) => {
    const deployedUrl =
      'https://fellspiral--220-fellspiral-card-library-improvements-7lj9anbp.web.app';

    // Enable console logging
    page.on('console', (msg) => {
      console.log(`[BROWSER ${msg.type()}]:`, msg.text());
    });

    // Enable error logging
    page.on('pageerror', (error) => {
      console.error('[BROWSER ERROR]:', error.message);
    });

    await page.goto(deployedUrl + '/cards.html');

    // Wait a bit for initial load
    await page.waitForTimeout(2000);

    // Check loading state visibility
    const loadingState = page.locator('.loading-state');
    const isLoadingVisible = await loadingState.isVisible();
    console.log('Loading state visible:', isLoadingVisible);

    // Check cardList visibility
    const cardList = page.locator('#cardList');
    const isCardListVisible = await cardList.isVisible();
    const cardListDisplay = await cardList.evaluate((el) => window.getComputedStyle(el).display);
    console.log('Card list visible:', isCardListVisible, 'display:', cardListDisplay);

    // Check empty state visibility
    const emptyState = page.locator('#emptyState');
    const isEmptyVisible = await emptyState.isVisible();
    const emptyDisplay = await emptyState.evaluate((el) => window.getComputedStyle(el).display);
    console.log('Empty state visible:', isEmptyVisible, 'display:', emptyDisplay);

    // Check card items
    const cardItemCount = await page.locator('.card-item').count();
    console.log('Card item count:', cardItemCount);

    // Check state in JavaScript
    const jsState = await page.evaluate(() => {
      return {
        loading: window.state?.loading,
        cardsLength: window.state?.cards?.length,
        filteredCardsLength: window.state?.filteredCards?.length,
        error: window.state?.error,
      };
    });
    console.log('JS State:', jsState);

    // Wait longer to see if it resolves
    await page.waitForTimeout(10000);

    // Check again
    const isLoadingVisibleAfter = await loadingState.isVisible();
    const cardItemCountAfter = await page.locator('.card-item').count();
    const isEmptyVisibleAfter = await emptyState.isVisible();

    console.log('After 10s wait:');
    console.log('  Loading visible:', isLoadingVisibleAfter);
    console.log('  Card count:', cardItemCountAfter);
    console.log('  Empty visible:', isEmptyVisibleAfter);

    const jsStateAfter = await page.evaluate(() => {
      return {
        loading: window.state?.loading,
        cardsLength: window.state?.cards?.length,
        filteredCardsLength: window.state?.filteredCards?.length,
        error: window.state?.error,
      };
    });
    console.log('JS State after:', jsStateAfter);
  });
});
