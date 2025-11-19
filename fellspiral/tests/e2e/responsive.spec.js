import { test, expect } from '@playwright/test';

test.describe('Responsive Design', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1920, height: 1080 },
  ];

  for (const viewport of viewports) {
    test(`should display correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      // Check that key elements are visible
      const hero = page.locator('.hero');
      await expect(hero).toBeVisible();

      const nav = page.locator('.navbar');
      await expect(nav).toBeVisible();

      // Check that content doesn't overflow
      const body = page.locator('body');
      const scrollWidth = await body.evaluate((el) => el.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 20); // Allow small margin
    });
  }

  test('should have working navigation on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Navigation should be visible
    const navMenu = page.locator('.nav-menu');
    await expect(navMenu).toBeVisible();

    // Should be able to click nav links
    const conceptsLink = page.locator('.nav-menu a', { hasText: 'Concepts' });
    await conceptsLink.click();

    // Should scroll to section
    await page.waitForTimeout(500);
    const conceptsSection = page.locator('#concepts');
    await expect(conceptsSection).toBeInViewport();
  });

  test('should have readable text on all viewport sizes', async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      // Check font sizes are readable
      const heroHeading = page.locator('.hero h1');
      const fontSize = await heroHeading.evaluate((el) => {
        return window.getComputedStyle(el).fontSize;
      });

      const fontSizeValue = parseFloat(fontSize);
      // Font size should be at least 16px (or equivalent)
      expect(fontSizeValue).toBeGreaterThanOrEqual(16);
    }
  });
});
