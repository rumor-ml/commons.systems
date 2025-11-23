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
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Wait a bit for styles to be applied
    await page.waitForTimeout(100);

    const bgColor = await sidebar.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // Should have a background color set (not transparent)
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('should have JavaScript loaded and functional', async ({ page }) => {
    await page.goto('/');

    // Wait for JavaScript to execute
    await page.waitForLoadState('networkidle');

    // Test that navigation highlighting works (requires JS)
    await page.goto('/#weapons');
    await page.waitForTimeout(500);

    const weaponsLink = page.locator('.sidebar-nav a[href="#weapons"]');
    await expect(weaponsLink).toHaveClass(/active/);
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Check that content is visible and readable
    const introduction = page.locator('#introduction');
    await expect(introduction).toBeVisible();

    const heading = page.locator('#introduction h1');
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
