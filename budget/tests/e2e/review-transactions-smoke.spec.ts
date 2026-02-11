import { test, expect } from '@playwright/test';

test.describe('Review Page Smoke Tests', () => {
  test('@smoke should load demo transactions on review page', async ({ page }) => {
    await page.goto('/#/review');

    // Verify no setup guide
    const setupGuide = page.locator('text=Firebase Setup Required');
    await expect(setupGuide).not.toBeVisible();

    // Wait for transactions to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });

    const rowCount = await page.locator('table tbody tr').count();
    expect(rowCount).toBe(91);
  });
});
