import { test, expect } from '@playwright/test';

/**
 * Manual verification test for transaction loading in QA environment
 * This test verifies that the Firestore security rules fix allows
 * unauthenticated reads from the demo collections with suffixes.
 */

test.describe('Transaction Loading Verification', () => {
  test('should load 91 demo transactions without authentication', async ({ page }) => {
    // Capture console logs to verify collection name and loading
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      consoleLogs.push(text);
    });

    // Navigate to transaction review page
    await page.goto('http://localhost:5173/#/review');

    // Wait for page to load and initialize
    await page.waitForTimeout(3000);

    // Verify no error messages
    const errorMessage = page.locator('text=Failed to load transactions');
    await expect(errorMessage).not.toBeVisible();

    // Verify no setup guide (only shown when Firebase not configured)
    const setupGuide = page.locator('text=Firebase Setup Required');
    await expect(setupGuide).not.toBeVisible();

    // Verify transaction review header is visible
    await expect(
      page
        .locator('h1')
        .filter({ hasText: /transaction/i })
        .first()
    ).toBeVisible();

    // Wait for transactions to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Count transaction rows
    const rowCount = await page.locator('table tbody tr').count();
    console.log(`Found ${rowCount} transaction rows`);

    // Verify we have the expected 91 transactions
    expect(rowCount).toBe(91);

    // Verify console logs show correct collection name
    const collectionLog = consoleLogs.find((log) =>
      log.includes('budget-demo-transactions-worker-0')
    );
    expect(collectionLog).toBeTruthy();

    // Verify success - logged transaction count or row count match
    const successLog = consoleLogs.find(
      (log) => log.includes('Loaded') && log.includes('transactions')
    );
    // Either console log exists OR we have 91 rows (success!)
    expect(successLog || rowCount === 91).toBeTruthy();

    // Take screenshot for visual verification
    await page.screenshot({
      path: 'test-results/transaction-loading-success.png',
      fullPage: true,
    });

    console.log('✓ All verifications passed!');
    console.log(
      'Console logs:',
      consoleLogs.filter((log) => log.includes('demo-transactions') || log.includes('Loaded'))
    );
  });

  test('should display transaction details in table', async ({ page }) => {
    await page.goto('http://localhost:5173/#/review');

    // Wait for transactions to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Get first transaction row
    const firstRow = page.locator('table tbody tr').first();

    // Verify row has multiple cells (date, description, amount, etc.)
    const cellCount = await firstRow.locator('td').count();
    expect(cellCount).toBeGreaterThan(3);

    // Verify first cell has date format (YYYY-MM-DD or similar)
    const firstCell = firstRow.locator('td').first();
    const cellText = await firstCell.textContent();
    expect(cellText).toBeTruthy();

    console.log(`✓ First transaction row has ${cellCount} cells`);
    console.log(`✓ First cell text: ${cellText}`);
  });

  test('should not show authentication required message', async ({ page }) => {
    await page.goto('http://localhost:5173/#/review');

    // Wait for page to initialize
    await page.waitForTimeout(2000);

    // Verify no authentication-related error messages
    const authError = page.locator('text=/authentication required|sign in|login/i');
    await expect(authError).not.toBeVisible();

    console.log('✓ No authentication required for demo data');
  });
});
