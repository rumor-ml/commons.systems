/**
 * Debug HTMX navigation on deployed site
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Debug HTMX Navigation on Deployed', () => {
  test('debug loading state after HTMX navigation', async ({ page }) => {
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

    // Start at homepage
    console.log('=== Starting at homepage ===');
    await page.goto(deployedUrl + '/');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });
    console.log('Library nav loaded');

    // Click Equipment type
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    console.log('=== Clicking Equipment toggle ===');
    await equipmentToggle.click();

    // Wait for URL change
    await page.waitForURL(/cards.*#library\/equipment$/, { timeout: 10000 });
    console.log('URL changed to cards page');

    // Wait a bit for any initial rendering
    await page.waitForTimeout(1000);

    // Check loading state immediately after navigation
    const loadingState = page.locator('.loading-state');
    const isLoadingVisible = await loadingState.isVisible();
    console.log('=== Immediately after HTMX navigation ===');
    console.log('Loading state visible:', isLoadingVisible);

    const cardList = page.locator('#cardList');
    const isCardListVisible = await cardList.isVisible();
    const cardListDisplay = await cardList.evaluate((el) => window.getComputedStyle(el).display);
    console.log('Card list visible:', isCardListVisible, 'display:', cardListDisplay);

    const emptyState = page.locator('#emptyState');
    const isEmptyVisible = await emptyState.isVisible();
    console.log('Empty state visible:', isEmptyVisible);

    const cardItemCount = await page.locator('.card-item').count();
    console.log('Card item count:', cardItemCount);

    // Wait 5 seconds to see if it changes
    console.log('=== Waiting 5 seconds ===');
    await page.waitForTimeout(5000);

    const isLoadingVisible5s = await loadingState.isVisible();
    const cardItemCount5s = await page.locator('.card-item').count();
    const isEmptyVisible5s = await emptyState.isVisible();

    console.log('After 5s wait:');
    console.log('  Loading visible:', isLoadingVisible5s);
    console.log('  Card count:', cardItemCount5s);
    console.log('  Empty visible:', isEmptyVisible5s);

    // Wait 10 more seconds
    console.log('=== Waiting 10 more seconds ===');
    await page.waitForTimeout(10000);

    const isLoadingVisible15s = await loadingState.isVisible();
    const cardItemCount15s = await page.locator('.card-item').count();
    const isEmptyVisible15s = await emptyState.isVisible();

    console.log('After 15s total wait:');
    console.log('  Loading visible:', isLoadingVisible15s);
    console.log('  Card count:', cardItemCount15s);
    console.log('  Empty visible:', isEmptyVisible15s);

    // Take a screenshot for debugging
    await page.screenshot({ path: '/tmp/claude/htmx-nav-debug.png', fullPage: true });
    console.log('Screenshot saved to /tmp/claude/htmx-nav-debug.png');
  });
});
