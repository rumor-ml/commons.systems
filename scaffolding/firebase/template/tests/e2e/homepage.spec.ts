import { test, expect } from '../../../playwright.fixtures';

test.describe('{{APP_NAME_TITLE}} Homepage', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/{{APP_NAME_TITLE}}/);
  });

  test('should display header with title', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('h1');
    await expect(header).toBeVisible();
    await expect(header).toContainText('{{APP_NAME_TITLE}}');
  });

  test('should display hero section', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('.hero');
    await expect(hero).toBeVisible();
    await expect(hero.locator('h2')).toContainText('Welcome');
  });

  test('should display content section', async ({ page }) => {
    await page.goto('/');
    const content = page.locator('.content');
    await expect(content).toBeVisible();
  });

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('.header')).toBeVisible();
    await expect(page.locator('.main')).toBeVisible();
  });
});

test.describe('Health Check', () => {
  test('health endpoint should return 200', async ({ page }) => {
    test.skip(!process.env.DEPLOYED, 'Health endpoint only available in deployed environment');
    const response = await page.goto('/health');
    expect(response?.status()).toBe(200);
  });
});
