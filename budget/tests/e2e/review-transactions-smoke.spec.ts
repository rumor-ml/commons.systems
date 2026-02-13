// TODO(#1959): Consolidate three separate E2E test cases into one comprehensive test
// TODO(#1965): Verify deleted test files have no dangling references in documentation
// TODO(#1968): Add negative test cases for authentication errors (emulator down, network fails)
// Consolidated smoke test for review page - replaces manual-check.spec.ts and verify-transaction-loading.spec.ts
import { test, expect } from '@playwright/test';
import { getTransactionsCollectionName } from '../../site/scripts/lib/collection-names.js';

test.describe('Review Page Smoke Tests', () => {
  test('@smoke should load demo transactions on review page', async ({ page }) => {
    // Capture all console messages for debugging
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('Budget') || text.includes('Firestore') || text.includes('collection')) {
        console.log(`[BROWSER ${msg.type()}] ${text}`);
      }
    });

    // For deployed tests, run-playwright-tests.sh already appends testCollection to baseURL
    // For local tests, we need to append it ourselves
    const isDeployed = process.env.DEPLOYED === 'true';
    console.log(`[TEST] Deployed mode: ${isDeployed}`);
    let url;

    if (isDeployed) {
      // Deployed mode: baseURL already has ?testCollection=..., just navigate to hash route
      // Use leading slash to ensure it's relative to baseURL
      url = '/#/review';
    } else {
      // Local/emulator mode: append collection name as query param
      const collectionName = getTransactionsCollectionName();
      console.log(`[TEST] Local collection: ${collectionName}`);
      url = `/?testCollection=${collectionName}#/review`;
    }

    console.log(`[TEST] Navigating to: ${url}`);
    await page.goto(url);

    // Log actual URL after navigation
    const finalUrl = page.url();
    const search = await page.evaluate(() => window.location.search);
    const hash = await page.evaluate(() => window.location.hash);
    console.log(`[TEST] Final URL: ${finalUrl}`);
    console.log(`[TEST] Search params: ${search}`);
    console.log(`[TEST] Hash: ${hash}`);

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
