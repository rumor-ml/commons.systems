import { test, expect } from '@playwright/test';

test.describe('Review Page - Transaction Loading', () => {
  test('should not show Firebase Setup Required on review page', async ({ page }) => {
    await page.goto('/#/review');
    await page.waitForTimeout(2000);

    const setupGuide = page.locator('text=Firebase Setup Required');
    await expect(setupGuide).not.toBeVisible();
  });

  test('should load demo transactions without authentication', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(msg.text()));

    await page.goto('/#/review');

    // Wait for transactions to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });

    const rowCount = await page.locator('table tbody tr').count();
    expect(rowCount).toBe(91);

    // Verify correct collection name in console
    const collectionLog = consoleLogs.find((log) => log.includes('demo-transactions'));
    expect(collectionLog).toBeTruthy();
  });

  test('should not show authentication errors', async ({ page }) => {
    await page.goto('/#/review');
    await page.waitForTimeout(2000);

    const authError = page.locator('text=/authentication required|sign in|login/i');
    await expect(authError).not.toBeVisible();
  });
});
