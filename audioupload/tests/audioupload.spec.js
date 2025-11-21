import { test, expect } from '@playwright/test';

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Audio Upload Manager/i);

  // Check for main heading
  const heading = page.locator('h1');
  await expect(heading).toContainText('Audio Upload Manager');
});

test('upload job starter form is present', async ({ page }) => {
  await page.goto('/');

  // Check for job starter form
  await expect(page.locator('#upload-job-form')).toBeVisible();
  await expect(page.locator('#job-name')).toBeVisible();
  await expect(page.locator('#base-path')).toBeVisible();
});

test('health endpoint returns healthy status', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.status).toBe('healthy');
});
