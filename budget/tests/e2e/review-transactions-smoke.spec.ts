// TODO(#1959): Consolidate three separate E2E test cases into one comprehensive test
// TODO(#1965): Verify deleted test files have no dangling references in documentation
// TODO(#1968): Add negative test cases for authentication errors (emulator down, network fails)
// Consolidated smoke test for review page - replaces manual-check.spec.ts and verify-transaction-loading.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Review Page Smoke Tests', () => {
  test('@smoke should load demo transactions on review page', async ({ page }) => {
    await page.goto('/#/review');

    const setupGuide = page.locator('text=Firebase Setup Required');
    await expect(setupGuide).not.toBeVisible();

    // Wait for transactions to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });

    // TODO(#1970): Replace hardcoded count with range check or threshold assertion
    const rowCount = await page.locator('table tbody tr').count();
    expect(rowCount).toBe(91);
  });
});
