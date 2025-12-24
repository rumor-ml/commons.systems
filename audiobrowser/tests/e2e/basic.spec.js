import { test, expect } from '../../../playwright.fixtures.ts';

test('@smoke homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Audio Browser');
});

test('@smoke audio player is present', async ({ page }) => {
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

// Health endpoint only exists in deployed Cloud Run service, not in static http-server
test('@smoke health check endpoint', async ({ page }) => {
  test.skip(!process.env.DEPLOYED, 'Health endpoint only available in deployed environment');
  const response = await page.goto('/health');
  expect(response.status()).toBe(200);
});
