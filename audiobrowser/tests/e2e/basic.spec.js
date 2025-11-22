import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Audio Browser');
});

test('audio player is present', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#audioPlayer')).toBeVisible();
});

test('search input is present', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#searchInput')).toBeVisible();
});

test('refresh button is present', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#refreshBtn')).toBeVisible();
});

test('health check endpoint', async ({ page }) => {
  const response = await page.goto('/health');
  expect(response.status()).toBe(200);
});
