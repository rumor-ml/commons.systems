/**
 * Debug test to verify HTMX navigation loads cards properly
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('HTMX Navigation Debug', () => {
  test('should show cards immediately after navigation (no refresh needed)', async ({ page }) => {
    // Start at homepage
    await page.goto('/');

    // Wait for library navigation to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Log initial state
    console.log('Homepage loaded, library nav visible');

    // Click Equipment type in library nav
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    console.log('Clicked Equipment toggle');

    // Wait for URL to change
    await page.waitForURL(/cards.*#library\/equipment$/, { timeout: 10000 });

    console.log('URL changed to:', page.url());

    // Log what's visible on the page
    const emptyStateVisible = await page
      .locator('.empty-state')
      .isVisible()
      .catch(() => false);
    const cardListVisible = await page
      .locator('#cardList')
      .isVisible()
      .catch(() => false);
    const cardItemCount = await page.locator('.card-item').count();

    console.log('Empty state visible:', emptyStateVisible);
    console.log('Card list visible:', cardListVisible);
    console.log('Card item count:', cardItemCount);

    // Wait a bit to see if cards load
    await page.waitForTimeout(2000);

    const cardItemCountAfterWait = await page.locator('.card-item').count();
    console.log('Card item count after 2s wait:', cardItemCountAfterWait);

    // Check if cards are visible
    await page.waitForSelector('.card-item', { timeout: 10000 });

    const finalCardCount = await page.locator('.card-item').count();
    console.log('Final card count:', finalCardCount);

    expect(finalCardCount).toBeGreaterThan(0);
  });

  test('should have card data loaded after HTMX swap', async ({ page }) => {
    // Enable console logging
    page.on('console', (msg) => console.log('BROWSER LOG:', msg.text()));

    await page.goto('/');
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Click Equipment
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    await page.waitForURL(/cards.*#library\/equipment$/, { timeout: 10000 });

    // Check if initCardsPage was called
    const cardsLoaded = await page.evaluate(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          const cardList = document.getElementById('cardList');
          const cardItems = document.querySelectorAll('.card-item');
          resolve({
            cardListExists: !!cardList,
            cardItemCount: cardItems.length,
            cardListHTML: cardList?.innerHTML.substring(0, 200),
          });
        }, 3000);
      });
    });

    console.log('Cards loaded state:', cardsLoaded);

    expect(cardsLoaded.cardItemCount).toBeGreaterThan(0);
  });
});
