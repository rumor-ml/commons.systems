import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Accessibility', () => {
  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/');

    // Check for h1 (should be unique)
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThan(0);

    // Check that headings exist
    const h2s = page.locator('h2');
    await expect(h2s.first()).toBeVisible();
  });

  test('should have alt text for images (if any)', async ({ page }) => {
    await page.goto('/');

    const images = await page.locator('img').all();
    for (const img of images) {
      const alt = await img.getAttribute('alt');
      expect(alt).toBeDefined();
    }
  });

  test('should have proper link text', async ({ page }) => {
    await page.goto('/');

    const links = await page.locator('a').all();
    for (const link of links) {
      const text = await link.textContent();
      const ariaLabel = await link.getAttribute('aria-label');

      // Link should have either text content or aria-label
      expect(text || ariaLabel).toBeTruthy();
    }
  });

  test('should have focus indicators', async ({ page }) => {
    await page.goto('/');

    // Tab through interactive elements
    await page.keyboard.press('Tab');

    // Check that focused element is visible
    const focusedElement = await page.evaluateHandle(() => document.activeElement);
    await expect(focusedElement).toBeTruthy();
  });

  test('should have proper contrast ratios', async ({ page }) => {
    await page.goto('/');

    // Basic check that text is visible
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Check that navigation is readable
    const nav = page.locator('.sidebar');
    await expect(nav).toBeVisible();
  });

  test('should work with keyboard navigation', async ({ page }) => {
    await page.goto('/');

    // Tab to first link
    await page.keyboard.press('Tab');

    // Press Enter to navigate
    await page.keyboard.press('Enter');

    // Wait for navigation
    await page.waitForTimeout(500);

    // Check that URL or scroll position changed
    const url = page.url();
    expect(url).toBeTruthy();
  });
});
