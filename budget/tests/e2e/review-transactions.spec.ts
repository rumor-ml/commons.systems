import { test, expect } from '@playwright/test';

test.describe('Review Page - Transaction Loading', () => {
  test('should load demo transactions without authentication or setup errors', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(msg.text()));

    await page.goto('/#/review');

    // Wait for transactions to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });

    // Verify correct transaction count
    const rowCount = await page.locator('table tbody tr').count();
    expect(rowCount).toBe(91);

    // Verify correct collection name in console
    const collectionLog = consoleLogs.find((log) => log.includes('demo-transactions'));
    expect(collectionLog).toBeTruthy();

    // Verify no error messages
    await expect(page.locator('text=Firebase Setup Required')).not.toBeVisible();
    await expect(page.locator('text=/authentication required|sign in|login/i')).not.toBeVisible();
  });
});
