import { test, expect } from '@playwright/test';

/**
 * E2E tests for transaction review page
 * Tests loading demo transactions in QA environment
 */

test.describe('Transaction Review Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the transaction review page
    await page.goto('http://localhost:5173/transactions');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');
  });

  test('should load and display demo transactions', async ({ page }) => {
    // Wait for transactions to load (spinner should appear then disappear)
    await expect(page.locator('.spinner'))
      .toBeVisible({ timeout: 2000 })
      .catch(() => {
        // Spinner might not be visible if loading is very fast
      });

    // Wait for transaction table to appear
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Check that we have transaction rows
    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    // Should have loaded transactions (expect at least 50 from demo data)
    expect(rowCount).toBeGreaterThan(50);

    // Check that transaction count is displayed in header
    const headerText = await page.locator('h2:has-text("Transaction Review")').textContent();
    expect(headerText).toContain('Transaction Review');

    // Transaction count should be visible
    const countText = await page.locator('p.text-text-secondary').first().textContent();
    expect(countText).toMatch(/\d+ of \d+ transactions/);
  });

  test('should display transaction details correctly', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Check table headers
    await expect(page.locator('th:has-text("Date")')).toBeVisible();
    await expect(page.locator('th:has-text("Description")')).toBeVisible();
    await expect(page.locator('th:has-text("Amount")')).toBeVisible();
    await expect(page.locator('th:has-text("Category")')).toBeVisible();
    await expect(page.locator('th:has-text("Flags")')).toBeVisible();

    // Check first transaction row has data
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow.locator('td').first()).toContainText(/\d{4}-\d{2}-\d{2}/); // Date format
  });

  test('should filter transactions by date range', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Get initial transaction count
    const initialRows = page.locator('tbody tr');
    const initialCount = await initialRows.count();

    // Set start date filter
    const startDateInput = page.locator('input[type="date"]').first();
    await startDateInput.fill('2024-01-01');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Get filtered transaction count
    const filteredRows = page.locator('tbody tr');
    const filteredCount = await filteredRows.count();

    // Should have fewer transactions after filtering
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('should filter transactions by category', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Find category filter dropdown
    const categorySelect = page.locator('select').first();
    await expect(categorySelect).toBeVisible();

    // Get all available categories
    const options = categorySelect.locator('option');
    const optionCount = await options.count();

    // Should have multiple category options (all + categories)
    expect(optionCount).toBeGreaterThan(1);

    // Select a specific category (not "all")
    const secondOption = await options.nth(1).textContent();
    if (secondOption && secondOption !== 'All Categories') {
      await categorySelect.selectOption({ index: 1 });

      // Wait for filter to apply
      await page.waitForTimeout(500);

      // Check that transactions are filtered
      const rows = page.locator('tbody tr');
      const rowCount = await rows.count();

      // Should have some transactions (but potentially fewer than total)
      expect(rowCount).toBeGreaterThan(0);
    }
  });

  test('should search transactions by description', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Find search input
    const searchInput = page.locator('input[type="text"]').first();
    await expect(searchInput).toBeVisible();

    // Get initial transaction count
    const initialRows = page.locator('tbody tr');
    const initialCount = await initialRows.count();

    // Search for a common term
    await searchInput.fill('payment');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Get filtered transaction count
    const filteredRows = page.locator('tbody tr');
    const filteredCount = await filteredRows.count();

    // Should have fewer or equal transactions after searching
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('should reset filters', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Get initial transaction count
    const initialRows = page.locator('tbody tr');
    const initialCount = await initialRows.count();

    // Apply filters
    const startDateInput = page.locator('input[type="date"]').first();
    await startDateInput.fill('2024-06-01');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Find and click reset button
    const resetButton = page.locator('button:has-text("Reset")');
    await expect(resetButton).toBeVisible();
    await resetButton.click();

    // Wait for reset to apply
    await page.waitForTimeout(500);

    // Get transaction count after reset
    const resetRows = page.locator('tbody tr');
    const resetCount = await resetRows.count();

    // Should be back to initial count
    expect(resetCount).toBe(initialCount);

    // Date input should be cleared
    const dateValue = await startDateInput.inputValue();
    expect(dateValue).toBe('');
  });

  test('should export transactions to CSV', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Set up download handler
    const downloadPromise = page.waitForEvent('download');

    // Click export button
    const exportButton = page.locator('button:has-text("Export to CSV")');
    await expect(exportButton).toBeVisible();
    await exportButton.click();

    // Wait for download to start
    const download = await downloadPromise;

    // Check download filename
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^transactions-\d{4}-\d{2}-\d{2}\.csv$/);

    // Verify download stream exists
    const stream = await download.createReadStream();
    expect(stream).toBeTruthy();
  });

  test('should show error message on load failure', async ({ page }) => {
    // Mock network failure by blocking Firestore requests
    await page.route('**/*', (route) => {
      if (route.request().url().includes('firestore')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Navigate to page
    await page.goto('http://localhost:5173/transactions');

    // Wait for error message
    await expect(page.locator('.bg-error-muted')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.text-error')).toContainText('Failed to load');

    // Retry button should be visible
    await expect(page.locator('button:has-text("Retry")')).toBeVisible();
  });

  test('should handle empty search results', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Search for a term that won't match anything
    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('xyzabc123nonexistent');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Should show "No transactions match your filters" message
    await expect(page.locator('text=No transactions match your filters')).toBeVisible();

    // Clear filters button should be visible
    await expect(page.locator('button:has-text("Clear Filters")')).toBeVisible();
  });
});
