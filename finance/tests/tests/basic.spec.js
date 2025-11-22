import { test, expect } from '@playwright/test';

test.describe('Finance Tracker Basic Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Check that the page loaded
    await expect(page.locator('.header__title')).toBeVisible();
    await expect(page.locator('.header__title')).toContainText('Finance Tracker');
  });

  test('health check endpoint returns 200', async ({ page }) => {
    const response = await page.goto('/health');
    expect(response?.status()).toBe(200);
  });

  test('has proper navigation structure', async ({ page }) => {
    await page.goto('/');

    // Check all nav buttons exist
    await expect(page.locator('.nav-btn[data-view="dashboard"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-view="transactions"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-view="accounts"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-view="budget"]')).toBeVisible();
  });
});
