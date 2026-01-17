import { test, expect } from '@playwright/test';

test.describe('Budget Indicator Lines', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');
    await page.waitForSelector('#chart-island svg', { timeout: 10000 });
  });

  test('should render indicator lines correctly in monthly view @smoke', async ({ page }) => {
    // Navigate to planning page and create a budget
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Set a budget for Housing category
    const housingInput = page.locator('input[name="housing-budget"]');
    await housingInput.fill('500');

    // Save budget plan
    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);

    // Wait for chart to re-render
    await page.waitForTimeout(500);

    // Find Housing category in legend and click indicator toggle
    const housingLegendItem = page.locator(
      '#legend-island .legend-category-row:has-text("Housing")'
    );
    await expect(housingLegendItem).toBeVisible();

    const indicatorToggle = housingLegendItem.locator('button:has-text("📊")');
    await expect(indicatorToggle).toBeVisible();
    await indicatorToggle.click();

    // Wait for chart to re-render with indicator lines
    await page.waitForTimeout(500);

    // Verify indicator lines are rendered
    const chartSvg = page.locator('#chart-island svg');
    const svgContent = await chartSvg.innerHTML();

    // Observable Plot renders lines as path elements
    // We should have 3 lines per category: actual (solid), trailing (dashed), target (dotted)
    const paths = page.locator('#chart-island svg path[stroke]');
    const pathCount = await paths.count();

    // At least 3 paths for the category indicator (actual, trailing, target)
    // Plus 2 for net income (if visible)
    expect(pathCount).toBeGreaterThanOrEqual(3);

    // Take screenshot for visual verification
    await page.screenshot({ path: 'test-results/budget-indicators-monthly.png', fullPage: true });
  });

  test('should render indicator lines correctly in weekly view', async ({ page }) => {
    // Navigate to planning page and create budgets
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Set budgets for multiple categories
    await page.locator('input[name="housing-budget"]').fill('500');
    await page.locator('input[name="dining-budget"]').fill('200');
    await page.locator('input[name="groceries-budget"]').fill('150');

    // Save budget plan
    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Switch to weekly bars
    const weeklyBarsRadio = page.locator('input[type="radio"][value="weekly"]');
    await weeklyBarsRadio.click();
    await page.waitForTimeout(800); // Wait for chart re-render

    // Enable indicator for Housing
    const housingLegendItem = page.locator(
      '#legend-island .legend-category-row:has-text("Housing")'
    );
    const housingIndicatorToggle = housingLegendItem.locator('button:has-text("📊")');
    await housingIndicatorToggle.click();
    await page.waitForTimeout(500);

    // Enable indicator for Dining
    const diningLegendItem = page.locator('#legend-island .legend-category-row:has-text("Dining")');
    const diningIndicatorToggle = diningLegendItem.locator('button:has-text("📊")');
    await diningIndicatorToggle.click();
    await page.waitForTimeout(500);

    // Verify indicator lines are rendered
    const paths = page.locator('#chart-island svg path[stroke]');
    const pathCount = await paths.count();

    // Should have:
    // - 3 lines per category (Housing, Dining) = 6 paths
    // - Plus 2 for net income (if visible) = 2 paths
    // Total: at least 6 paths
    expect(pathCount).toBeGreaterThanOrEqual(6);

    // Take screenshot for visual verification
    await page.screenshot({ path: 'test-results/budget-indicators-weekly.png', fullPage: true });

    // Verify x-axis shows valid dates (not "Invalid Date")
    const xAxisLabels = page.locator('#chart-island svg g[aria-label="x-axis tick label"] text');
    const firstLabel = await xAxisLabels.first().textContent();
    expect(firstLabel).not.toContain('Invalid');
    expect(firstLabel).toMatch(/\w+ \d+/); // Should be like "Jan 1" or "Dec 23"
  });

  test('should align indicator lines with bars in weekly view', async ({ page }) => {
    // Set up budget
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await page.locator('input[name="groceries-budget"]').fill('150');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Switch to weekly bars
    const weeklyBarsRadio = page.locator('input[type="radio"][value="weekly"]');
    await weeklyBarsRadio.click();
    await page.waitForTimeout(800);

    // Enable indicator for Groceries
    const groceriesLegendItem = page.locator(
      '#legend-island .legend-category-row:has-text("Groceries")'
    );
    const groceriesIndicatorToggle = groceriesLegendItem.locator('button:has-text("📊")');
    await groceriesIndicatorToggle.click();
    await page.waitForTimeout(500);

    // Get the SVG element
    const chartSvg = page.locator('#chart-island svg');

    // Get bar positions
    const bars = page.locator('#chart-island svg rect[fill]');
    const barCount = await bars.count();
    expect(barCount).toBeGreaterThan(0);

    // Get the first bar's x position
    const firstBar = bars.first();
    const firstBarBox = await firstBar.boundingBox();
    expect(firstBarBox).not.toBeNull();

    // Get line paths
    const linePaths = page.locator('#chart-island svg path[stroke]');
    const lineCount = await linePaths.count();
    expect(lineCount).toBeGreaterThanOrEqual(3);

    // Get the first line path's bounding box
    const firstLine = linePaths.first();
    const firstLineBox = await firstLine.boundingBox();
    expect(firstLineBox).not.toBeNull();

    // Verify lines and bars have overlapping x-coordinates (within SVG bounds)
    // Lines should start near the first bar's x position
    if (firstBarBox && firstLineBox) {
      const xOverlap = Math.abs(firstBarBox.x - firstLineBox.x);
      // Allow some tolerance for SVG rendering differences
      expect(xOverlap).toBeLessThan(200); // Lines should be within reasonable distance of bars
    }

    // Take screenshot for debugging
    await page.screenshot({
      path: 'test-results/budget-indicators-alignment-weekly.png',
      fullPage: true,
    });
  });

  test('should show correct line styles for budget indicators', async ({ page }) => {
    // Set up budget
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await page.locator('input[name="utilities-budget"]').fill('100');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Enable indicator for Utilities
    const utilitiesLegendItem = page.locator(
      '#legend-island .legend-category-row:has-text("Utilities")'
    );
    const utilitiesIndicatorToggle = utilitiesLegendItem.locator('button:has-text("📊")');
    await utilitiesIndicatorToggle.click();
    await page.waitForTimeout(500);

    // Verify line styles in SVG
    const chartSvg = page.locator('#chart-island svg');

    // Check for solid line (actual spending) - no stroke-dasharray
    const solidLines = page.locator('#chart-island svg path[stroke]:not([stroke-dasharray])');
    const solidCount = await solidLines.count();
    expect(solidCount).toBeGreaterThanOrEqual(1);

    // Check for dashed line (trailing average) - stroke-dasharray="5,5"
    const dashedLines = page.locator('#chart-island svg path[stroke-dasharray="5,5"]');
    const dashedCount = await dashedLines.count();
    expect(dashedCount).toBeGreaterThanOrEqual(1);

    // Check for dotted line (budget target) - stroke-dasharray="2,3"
    const dottedLines = page.locator('#chart-island svg path[stroke-dasharray="2,3"]');
    const dottedCount = await dottedLines.count();
    expect(dottedCount).toBeGreaterThanOrEqual(1);
  });

  test('should toggle indicator lines on/off', async ({ page }) => {
    // Set up budget
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await page.locator('input[name="housing-budget"]').fill('500');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Get initial path count (should only have net income lines)
    const initialPaths = page.locator('#chart-island svg path[stroke]');
    const initialCount = await initialPaths.count();

    // Enable indicator for Housing
    const housingLegendItem = page.locator(
      '#legend-island .legend-category-row:has-text("Housing")'
    );
    const housingIndicatorToggle = housingLegendItem.locator('button:has-text("📊")');
    await housingIndicatorToggle.click();
    await page.waitForTimeout(500);

    // Path count should increase (3 more lines)
    const enabledPaths = page.locator('#chart-island svg path[stroke]');
    const enabledCount = await enabledPaths.count();
    expect(enabledCount).toBeGreaterThan(initialCount);

    // Click again to disable
    await housingIndicatorToggle.click();
    await page.waitForTimeout(500);

    // Path count should return to initial
    const disabledPaths = page.locator('#chart-island svg path[stroke]');
    const disabledCount = await disabledPaths.count();
    expect(disabledCount).toBe(initialCount);
  });

  test('should display legend with line type explanations', async ({ page }) => {
    // Set up budget
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await page.locator('input[name="housing-budget"]').fill('500');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Verify legend shows line type explanations
    const legend = page.locator('#legend-island');

    // Check for "Budget Lines" section
    await expect(legend.locator('text=Budget Lines')).toBeVisible();

    // Check for line type explanations
    await expect(legend.locator('text=Actual Spending')).toBeVisible();
    await expect(legend.locator('text=3-Period Trailing Avg')).toBeVisible();
    await expect(legend.locator('text=Budget Target')).toBeVisible();
  });

  test('should persist indicator visibility across page reloads', async ({ page }) => {
    // Set up budget
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await page.locator('input[name="dining-budget"]').fill('200');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Enable indicator for Dining
    const diningLegendItem = page.locator('#legend-island .legend-category-row:has-text("Dining")');
    const diningIndicatorToggle = diningLegendItem.locator('button:has-text("📊")');
    await diningIndicatorToggle.click();
    await page.waitForTimeout(500);

    // Verify lines are visible
    const pathsBeforeReload = page.locator('#chart-island svg path[stroke]');
    const countBeforeReload = await pathsBeforeReload.count();
    expect(countBeforeReload).toBeGreaterThan(2); // Should have multiple lines

    // Reload page
    await page.reload();
    await page.waitForSelector('.app-container');
    await page.waitForSelector('#chart-island svg', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Verify lines are still visible after reload
    const pathsAfterReload = page.locator('#chart-island svg path[stroke]');
    const countAfterReload = await pathsAfterReload.count();
    expect(countAfterReload).toBe(countBeforeReload);
  });

  test('should switch between monthly and weekly with indicators enabled', async ({ page }) => {
    // Set up budget
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await page.locator('input[name="groceries-budget"]').fill('150');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Enable indicator
    const groceriesLegendItem = page.locator(
      '#legend-island .legend-category-row:has-text("Groceries")'
    );
    const groceriesIndicatorToggle = groceriesLegendItem.locator('button:has-text("📊")');
    await groceriesIndicatorToggle.click();
    await page.waitForTimeout(500);

    // Take screenshot in monthly view
    await page.screenshot({ path: 'test-results/indicators-monthly-switch.png', fullPage: true });

    // Switch to weekly
    const weeklyBarsRadio = page.locator('input[type="radio"][value="weekly"]');
    await weeklyBarsRadio.click();
    await page.waitForTimeout(800);

    // Verify lines still visible and x-axis is valid
    const pathsWeekly = page.locator('#chart-island svg path[stroke]');
    const countWeekly = await pathsWeekly.count();
    expect(countWeekly).toBeGreaterThan(2);

    const xAxisLabels = page.locator('#chart-island svg g[aria-label="x-axis tick label"] text');
    const firstLabel = await xAxisLabels.first().textContent();
    expect(firstLabel).not.toContain('Invalid');

    // Take screenshot in weekly view
    await page.screenshot({ path: 'test-results/indicators-weekly-switch.png', fullPage: true });

    // Switch back to monthly
    const monthlyBarsRadio = page.locator('input[type="radio"][value="monthly"]');
    await monthlyBarsRadio.click();
    await page.waitForTimeout(800);

    // Verify lines still visible
    const pathsMonthly = page.locator('#chart-island svg path[stroke]');
    const countMonthly = await pathsMonthly.count();
    expect(countMonthly).toBeGreaterThan(2);
  });
});
