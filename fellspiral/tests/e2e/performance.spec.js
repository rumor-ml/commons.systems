import { test, expect } from '@playwright/test';

test.describe('Performance', () => {
  test('should load page within acceptable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    const loadTime = Date.now() - startTime;

    // Page should load within 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });

  test('should have reasonable page size', async ({ page }) => {
    const response = await page.goto('/');
    const body = await response.body();

    // HTML should be less than 500KB
    expect(body.length).toBeLessThan(500 * 1024);
  });

  test('should have CSS loaded', async ({ page }) => {
    await page.goto('/');

    // Wait for CSS to be loaded
    await page.waitForLoadState('domcontentloaded');

    // Check that styles are applied by checking computed styles
    const hero = page.locator('.hero');
    await expect(hero).toBeVisible();

    // Wait a bit for styles to be applied
    await page.waitForTimeout(100);

    const bgImage = await hero.evaluate((el) => {
      return window.getComputedStyle(el).backgroundImage;
    });

    // Should have a gradient background (not none)
    expect(bgImage).toContain('linear-gradient');
  });

  test('should have JavaScript loaded and functional', async ({ page }) => {
    await page.goto('/');

    // Wait for JavaScript to execute
    await page.waitForLoadState('networkidle');

    // Test that tab functionality works (requires JS)
    const armorTab = page.locator('.tab-btn[data-tab="armor"]');
    await armorTab.click();

    const armorContent = page.locator('#armor');
    await expect(armorContent).toHaveClass(/active/);
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Check that content is visible and readable
    const hero = page.locator('.hero');
    await expect(hero).toBeVisible();

    const heading = page.locator('.hero h1');
    await expect(heading).toBeVisible();
  });

  test('should not have console errors', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should have no console errors
    expect(errors).toHaveLength(0);
  });
});
