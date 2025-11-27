import { test, expect } from '../../../playwright.fixtures.ts';

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
      const introduction = page.locator('#introduction');
      await expect(introduction).toBeVisible();

      const sidebar = page.locator('.sidebar');
      await expect(sidebar).toBeAttached();

      // Check that content doesn't overflow
      const body = page.locator('body');
      const scrollWidth = await body.evaluate((el) => el.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 20); // Allow small margin
    });
  }

  test('should have mobile menu toggle on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Mobile menu toggle should be visible
    const menuToggle = page.locator('.mobile-menu-toggle');
    await expect(menuToggle).toBeVisible();

    // Sidebar should be hidden initially on mobile
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).not.toHaveClass(/active/);

    // Click toggle to show sidebar
    await menuToggle.click();
    await page.waitForTimeout(300); // Wait for animation
    await expect(sidebar).toHaveClass(/active/);

    // Should be able to click nav links
    const initiativeLink = page.locator('.sidebar-nav a[href="#initiative"]');
    await initiativeLink.click();

    // Should scroll to section
    await page.waitForTimeout(500);
    const initiativeSection = page.locator('#initiative');
    await expect(initiativeSection).toBeInViewport();

    // Sidebar should close after clicking link on mobile
    await expect(sidebar).not.toHaveClass(/active/);
  });

  test('should have readable text on all viewport sizes', async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      // Check font sizes are readable
      const mainHeading = page.locator('#introduction h1');
      const fontSize = await mainHeading.evaluate((el) => {
        return window.getComputedStyle(el).fontSize;
      });

      const fontSizeValue = parseFloat(fontSize);
      // Font size should be at least 16px (or equivalent)
      expect(fontSizeValue).toBeGreaterThanOrEqual(16);
    }
  });

  test('should show/hide mobile menu toggle based on viewport', async ({ page }) => {
    const toggle = page.locator('#mobileMenuToggle');

    // Desktop - toggle should be hidden
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await expect(toggle).toBeHidden();

    // Tablet - toggle should be visible
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(toggle).toBeVisible();

    // Mobile - toggle should be visible
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(toggle).toBeVisible();
  });
});
