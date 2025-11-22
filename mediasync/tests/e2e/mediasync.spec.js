import { test, expect } from '@playwright/test';

// MediaSync requires the Go backend to serve both API and frontend assets
// Tests only run in deployed mode where the full stack is available
const isDeployedMode = process.env.DEPLOYED === 'true';

test.describe('MediaSync Site Tests', () => {
  test.beforeEach(async ({}, testInfo) => {
    // Skip all tests if not in deployed mode
    test.skip(!isDeployedMode, 'MediaSync tests require Go backend, only available in deployed environment');
  });

  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Check for main heading
    const heading = page.locator('h1');
    await expect(heading).toContainText('MediaSync');

    // Check for description
    const description = page.locator('header p.subtitle');
    await expect(description).toContainText('Sync your media files to Google Cloud Storage');
  });

  test('strategies section displays available media types', async ({ page }) => {
    await page.goto('/');

    // Check for strategies section
    const strategiesSection = page.locator('#strategy-info');
    await expect(strategiesSection).toBeVisible();

    // Wait for strategies to load
    await page.waitForSelector('.strategy-card', { timeout: 10000 });

    // Verify at least one strategy is shown
    const strategyCards = page.locator('.strategy-card');
    const count = await strategyCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('upload job starter section is present', async ({ page }) => {
    await page.goto('/');

    // Check for job starter section
    const starterSection = page.locator('#job-starter');
    await expect(starterSection).toBeVisible();

    // Since the form is rendered dynamically, wait for it to appear
    await page.waitForSelector('#upload-job-form', { timeout: 10000 });

    // Verify strategy selection dropdown exists
    await expect(page.locator('#strategy-name')).toBeVisible();
    await expect(page.locator('#job-name')).toBeVisible();
    await expect(page.locator('#base-path')).toBeVisible();
    await expect(page.locator('#gcs-base-path')).toBeVisible();
  });

  test('job monitor section exists but is hidden initially', async ({ page }) => {
    await page.goto('/');

    const monitorSection = page.locator('#job-monitor');
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

  test('strategies API endpoint returns list of strategies', async ({ request }) => {
    const response = await request.get('/api/strategies');
    expect(response.ok()).toBeTruthy();

    const strategies = await response.json();
    expect(Array.isArray(strategies)).toBeTruthy();
    expect(strategies.length).toBeGreaterThan(0);

    // Verify strategy structure
    const firstStrategy = strategies[0];
    expect(firstStrategy).toHaveProperty('name');
    expect(firstStrategy).toHaveProperty('extensions');
    expect(Array.isArray(firstStrategy.extensions)).toBeTruthy();
  });
});
