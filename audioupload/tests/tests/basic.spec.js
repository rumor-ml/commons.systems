import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Welcome to Audioupload');
});

test('health check endpoint', async ({ page }) => {
  const response = await page.goto('/health');
  expect(response.status()).toBe(200);
});
