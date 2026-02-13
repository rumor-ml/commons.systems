// TODO(#1959): Consolidate three separate E2E test cases into one comprehensive test
// TODO(#1965): Verify deleted test files have no dangling references in documentation
// TODO(#1968): Add negative test cases for authentication errors (emulator down, network fails)
// Consolidated smoke test for review page - replaces manual-check.spec.ts and verify-transaction-loading.spec.ts
import { test, expect } from '@playwright/test';
import { getTransactionsCollectionName } from '../../site/scripts/lib/collection-names.js';

test.describe('Review Page Smoke Tests', () => {
  test('@smoke should load demo transactions on review page', async ({ page }) => {
    // For deployed tests, run-playwright-tests.sh sets DEPLOYED_URL with testCollection param
    // For local tests, we need to construct the URL ourselves
    const isDeployed = process.env.DEPLOYED === 'true';
    const deployedUrl = process.env.DEPLOYED_URL || '';
    let url;

    if (isDeployed && deployedUrl) {
      // Deployed mode: DEPLOYED_URL has baseURL + ?testCollection=...
      // Parse it to preserve query params when adding hash route
      const urlObj = new URL(deployedUrl);
      url = `${urlObj.pathname}${urlObj.search}#/review`;
    } else {
      // Local/emulator mode: construct URL with collection name
      const collectionName = getTransactionsCollectionName();
      url = `/?testCollection=${collectionName}#/review`;
    }

    await page.goto(url);

    // Wait for app to initialize
    await page.waitForSelector('.app-container', { timeout: 10000 });

    const setupGuide = page.locator('text=Firebase Setup Required');
    await expect(setupGuide).not.toBeVisible();

    // Wait for transactions to load from Firestore (increased timeout for emulator stability)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30000 });

    // TODO(#1970): Replace hardcoded count with range check or threshold assertion
    const rowCount = await page.locator('table tbody tr').count();
    expect(rowCount).toBe(91);
  });
});
