import { test, expect } from '@playwright/test';

// Audioupload requires the Go backend to serve both API and frontend assets
// Tests only run in deployed mode where the full stack is available
const isDeployedMode = process.env.DEPLOYED === 'true';

test.describe('Audioupload Site Tests', () => {
  test.beforeEach(async ({}, testInfo) => {
    // Skip all tests if not in deployed mode
    test.skip(!isDeployedMode, 'Audioupload tests require Go backend, only available in deployed environment');
  });

  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Check for main heading
    const heading = page.locator('h1');
    await expect(heading).toContainText('Audio Upload Manager');

    // Check for description
    const description = page.locator('header p');
    await expect(description).toContainText('Upload and organize your audio files');
  });

  test('upload job starter section is present', async ({ page }) => {
    await page.goto('/');

    // Check for job starter section
    const starterSection = page.locator('#job-starter-section');
    await expect(starterSection).toBeVisible();

    // Since the form is rendered dynamically, wait for it to appear
    await page.waitForSelector('#upload-job-form', { timeout: 10000 });

    await expect(page.locator('#job-name')).toBeVisible();
    await expect(page.locator('#base-path')).toBeVisible();
    await expect(page.locator('#gcs-base-path')).toBeVisible();
  });

  test('job monitor section exists but is hidden initially', async ({ page }) => {
    await page.goto('/');

    const monitorSection = page.locator('#job-monitor-section');
    await expect(monitorSection).toBeAttached();

    // Should be hidden by default
    await expect(monitorSection).toHaveCSS('display', 'none');
  });

  test('health endpoint returns healthy status', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('healthy');
  });
});
