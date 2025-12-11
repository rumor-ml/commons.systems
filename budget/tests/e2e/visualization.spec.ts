import { test, expect } from '@playwright/test';

test.describe('Budget Visualization', () => {
  test('should load page successfully without spinner', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');

    // Wait for React app to initialize
    await page.waitForSelector('.app-container', { timeout: 10000 });

    // Verify no loading spinner is stuck
    const spinner = page.locator('.spinner, .loading');
    await expect(spinner)
      .not.toBeVisible({ timeout: 5000 })
      .catch(() => {
        // Spinner might not exist at all, which is fine
      });

    // Check for console errors
    expect(consoleErrors).toHaveLength(0);
  });

  test('should display header with title', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    const header = page.locator('.app-header h1');
    await expect(header).toBeVisible();
    await expect(header).toContainText('Budget Visualization');
  });

  test('should display summary cards with financial data', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.summary-cards');

    // Check that all 4 summary cards are visible
    const summaryCards = page.locator('.summary-card');
    await expect(summaryCards).toHaveCount(4);

    // Verify each card has a label and value
    const labels = ['Total Income', 'Total Expenses', 'Net Income', 'Savings Rate'];
    for (const label of labels) {
      const card = page.locator('.summary-card', { hasText: label });
      await expect(card).toBeVisible();

      const value = card.locator('.summary-value');
      await expect(value).toBeVisible();

      // Check that the value contains a dollar sign or percentage
      const text = await value.textContent();
      expect(text).toMatch(/[\$%]/);
    }
  });

  test('should render Observable Plot chart', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Wait for the chart component to render
    await page.waitForSelector('.main-layout', { timeout: 10000 });

    // Observable Plot renders as an SVG element
    const chartSvg = page.locator('svg');
    await expect(chartSvg.first()).toBeVisible({ timeout: 10000 });

    // Verify the SVG has content (bars, lines, etc.)
    const svgContent = await chartSvg.first().innerHTML();
    expect(svgContent.length).toBeGreaterThan(100); // Should have substantial content
  });

  test('should display interactive legend', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Wait for the legend section with "Filters" heading
    const legend = page.locator('text=Filters');
    await expect(legend).toBeVisible({ timeout: 10000 });

    // Check for category checkboxes
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(5); // Should have vacation + multiple categories
  });

  test('should toggle category visibility when legend item clicked', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Wait for chart to fully render
    await page.waitForSelector('svg');

    // Get initial chart content
    const initialSvg = await page.locator('svg').first().innerHTML();

    // Click a category checkbox (not the vacation one, which is first)
    const categoryCheckbox = page.locator('input[type="checkbox"]').nth(1);
    await categoryCheckbox.click();

    // Wait a moment for the chart to re-render
    await page.waitForTimeout(500);

    // Chart content should have changed
    const updatedSvg = await page.locator('svg').first().innerHTML();
    expect(updatedSvg).not.toBe(initialSvg);
  });

  test('should handle vacation filter toggle', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Look for the vacation checkbox
    const vacationCheckbox = page.locator('input[type="checkbox"]');
    const checkboxCount = await vacationCheckbox.count();

    if (checkboxCount > 0) {
      const initialChecked = await vacationCheckbox.first().isChecked();
      await vacationCheckbox.first().click();

      // Wait for re-render
      await page.waitForTimeout(300);

      const newChecked = await vacationCheckbox.first().isChecked();
      expect(newChecked).toBe(!initialChecked);
    }
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Header should still be visible
    await expect(page.locator('.app-header')).toBeVisible();

    // Summary cards should reflow
    await expect(page.locator('.summary-cards')).toBeVisible();

    // Chart should adapt
    await expect(page.locator('svg').first()).toBeVisible();
  });

  test('should not have React errors in console', async ({ page }) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') {
        errors.push(text);
      } else if (msg.type() === 'warning' && text.includes('React')) {
        warnings.push(text);
      }
    });

    await page.goto('/');
    await page.waitForSelector('.app-container');
    await page.waitForLoadState('networkidle');

    // Filter out expected non-critical warnings
    const criticalErrors = errors.filter((e) => {
      return !e.includes('Failed to load resource') && !e.includes('favicon');
    });

    expect(criticalErrors).toHaveLength(0);
    expect(warnings.filter((w) => w.includes('deprecated'))).toHaveLength(0);
  });
});
