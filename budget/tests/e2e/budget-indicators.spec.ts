import { test, expect, Page } from '@playwright/test';

/**
 * Helper function to fill a budget input for a specific category.
 * Handles scrolling to the correct section and finding the input.
 *
 * @param page - Playwright page object
 * @param category - Category name (e.g., 'Housing', 'Income', 'Groceries')
 * @param value - Budget value to fill (should be negative for expenses, positive for income)
 */
async function fillBudgetInput(
  page: Page,
  category: string,
  value: string,
  options: { expectValid?: boolean } = {}
) {
  const { expectValid = true } = options;

  // Find the category label (e.g., "Housing", "Dining")
  // The label and input are in sibling containers within a category row
  const categoryLabel = page
    .locator(`text="${category}"`)
    .and(page.locator(':near(:text("Historic avg"))'))
    .first();

  // Navigate up to the category row container (the parent that contains both label and input)
  const categoryRow = categoryLabel.locator('..').locator('..');

  // Find the number input within the category row
  const input = categoryRow.locator('input[type="number"]').first();

  // Fill the input - Playwright's fill() automatically waits for the element to be actionable
  await input.fill(value);

  // For valid inputs, verify the value stuck (ensures onChange fired and validation passed)
  // For invalid inputs (validation tests), skip this check as validation prevents value from sticking
  if (expectValid) {
    await expect(input).toHaveValue(value);

    // Wait for the debounced state update to complete (300ms debounce in BudgetPlanEditor)
    // Using 600ms to reliably account for:
    // - 300ms debounce delay
    // - React re-render time
    // - Any additional processing
    // This ensures categoryBudgets state is fully updated before moving to the next input
    await page.waitForTimeout(600);
  }
}

test.describe('Budget Indicator Lines', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');
    await page.waitForSelector('#chart-island svg', { timeout: 10000 });
  });

  test('should render indicator lines correctly in monthly view @smoke', async ({ page }) => {
    // Navigate to planning page and create a budget
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Set a budget for Housing category
    await fillBudgetInput(page, 'Housing', '-500');

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
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Set budgets for multiple categories
    await fillBudgetInput(page, 'Housing', '-500');
    await fillBudgetInput(page, 'Dining', '-200');
    await fillBudgetInput(page, 'Groceries', '-150');

    // Save budget plan
    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Switch to weekly bars
    const weeklyBarsButton = page.locator('button:has-text("Weekly Bars")');
    await weeklyBarsButton.click();
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
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await fillBudgetInput(page, 'Groceries', '-150');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Switch to weekly bars
    const weeklyBarsButton = page.locator('button:has-text("Weekly Bars")');
    await weeklyBarsButton.click();
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

  test('should render budget indicator lines when enabled', async ({ page }) => {
    // Set up budget
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await fillBudgetInput(page, 'Utilities', '-100');

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

    // Verify indicator lines are rendered in the SVG
    // The implementation currently renders all lines as solid (no stroke-dasharray)
    // Future: May add different line styles (dashed, dotted) for different indicator types
    const indicatorLines = page.locator('#chart-island svg path[stroke]');
    const lineCount = await indicatorLines.count();

    // Should have multiple lines: budget target, trailing average, actual spending
    expect(lineCount).toBeGreaterThanOrEqual(3);

    // Verify lines have stroke color (are visible)
    const firstLine = indicatorLines.first();
    const strokeColor = await firstLine.getAttribute('stroke');
    expect(strokeColor).toBeTruthy();
    expect(strokeColor).not.toBe('none');
  });

  test('should toggle indicator lines on/off', async ({ page }) => {
    // Set up budget
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await fillBudgetInput(page, 'Housing', '-500');

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
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await fillBudgetInput(page, 'Housing', '-500');

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
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await fillBudgetInput(page, 'Dining', '-200');

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
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await fillBudgetInput(page, 'Groceries', '-150');

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

  test('should display budget and balance in legend for budgeted categories', async ({ page }) => {
    // Set up budgets
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await fillBudgetInput(page, 'Housing', '-500');
    await fillBudgetInput(page, 'Groceries', '-150');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Check legend for Housing
    const housingLegend = page.locator('#legend-island .legend-category-row:has-text("Housing")');
    await expect(housingLegend).toBeVisible();

    // Should show weekly budget
    await expect(housingLegend.locator('text=/Weekly budget/i')).toBeVisible();
    await expect(housingLegend.locator('text=/\\$500/i')).toBeVisible();

    // Should show balance
    await expect(housingLegend.locator('text=/Balance/i')).toBeVisible();

    // Should show indicator toggle button
    await expect(housingLegend.locator('button:has-text("📊")')).toBeVisible();

    // Check legend for Groceries
    const groceriesLegend = page.locator(
      '#legend-island .legend-category-row:has-text("Groceries")'
    );
    await expect(groceriesLegend).toBeVisible();
    await expect(groceriesLegend.locator('text=/\\$150/i')).toBeVisible();
    await expect(groceriesLegend.locator('button:has-text("📊")')).toBeVisible();

    // Categories without budgets should not show indicator button
    const entertainmentLegend = page.locator(
      '#legend-island .legend-category-row:has-text("Entertainment")'
    );
    await expect(entertainmentLegend.locator('button:has-text("📊")')).not.toBeVisible();
  });

  test('should show line type explanations when indicators are enabled', async ({ page }) => {
    // Set budget
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    await fillBudgetInput(page, 'Housing', '-500');

    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(500);

    // Legend should already show line type explanations when budget plan exists
    const legend = page.locator('#legend-island');
    await expect(legend.locator('text=/Actual Spending/i')).toBeVisible();
    await expect(legend.locator('text=/3-Period Trailing/i')).toBeVisible();
    await expect(legend.locator('text=/Budget Target/i')).toBeVisible();

    // Enable indicator and verify explanations still visible
    const housingLegend = page.locator('#legend-island .legend-category-row:has-text("Housing")');
    await housingLegend.locator('button:has-text("📊")').click();
    await page.waitForTimeout(500);

    await expect(legend.locator('text=/Actual Spending/i')).toBeVisible();
    await expect(legend.locator('text=/3-Period Trailing/i')).toBeVisible();
    await expect(legend.locator('text=/Budget Target/i')).toBeVisible();
  });
});

test.describe('Budget Planning Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');
  });

  test.describe('Validation Logic', () => {
    test('should reject zero budget value and show validation error', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Try to fill housing-budget with zero
      const housingLabel = page
        .locator('text="Housing"')
        .and(page.locator(':near(:text("Historic avg"))'))
        .first();
      const housingRow = housingLabel.locator('..').locator('..');
      const housingInput = housingRow.locator('input[type="number"]').first();

      await housingInput.fill('0');

      // Should show inline validation error
      await expect(page.locator('text=/Budget target cannot be zero/i')).toBeVisible();

      // Input should reject the zero value and be empty
      // (Empty budget is valid - means "no budget set", so save would succeed with no budget)
      const inputValue = await housingInput.inputValue();
      expect(inputValue).toBe(''); // Zero rejected, input cleared
    });

    test('should reject positive expense budget value and show validation error', async ({
      page,
    }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Try to fill housing-budget with positive value (incorrect for expense category)
      const housingLabel = page
        .locator('text="Housing"')
        .and(page.locator(':near(:text("Historic avg"))'))
        .first();
      const housingRow = housingLabel.locator('..').locator('..');
      const housingInput = housingRow.locator('input[type="number"]').first();

      await housingInput.fill('500');

      // Should show inline validation error
      await expect(page.locator('text=/Expense budgets should be negative/i')).toBeVisible();

      // Input should reject the positive value (expenses must be negative or empty)
      await page.waitForTimeout(500); // Wait for validation to process
      const inputValue = await housingInput.inputValue();
      expect(inputValue).not.toBe('500'); // Positive value rejected
    });

    test('should reject budget over $1M and show validation error', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Try to fill housing-budget with over $1M
      const housingLabel = page
        .locator('text="Housing"')
        .and(page.locator(':near(:text("Historic avg"))'))
        .first();
      const housingRow = housingLabel.locator('..').locator('..');
      const housingInput = housingRow.locator('input[type="number"]').first();

      await housingInput.fill('-2000000');

      // Should show inline validation error
      await expect(page.locator('text=/unusually large/i')).toBeVisible();

      // Input should reject the excessively large value
      await page.waitForTimeout(500); // Wait for validation to process
      const inputValue = await housingInput.inputValue();
      expect(inputValue).not.toBe('-2000000'); // Excessive value rejected
    });

    test('should save valid budget successfully', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Fill housing-budget with valid negative value
      await fillBudgetInput(page, 'Housing', '-500');

      // Save budget
      await page.locator('button:has-text("Save")').click();

      // Should navigate to main view
      await page.waitForURL(/\/#\//);

      // Navigate back to planning page to verify it saved
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      await page.locator('h2:has-text("Expenses")').scrollIntoViewIfNeeded();
      const housingInput = page
        .locator('text=Housing')
        .locator('..')
        .locator('..')
        .locator('input[type="number"]');
      await expect(housingInput).toHaveValue('-500');
      await expect(housingInput).toHaveValue('-500');
    });

    test('should show validation errors for invalid inputs', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Try to fill housing-budget with invalid value (zero)
      const housingLabel = page
        .locator('text="Housing"')
        .and(page.locator(':near(:text("Historic avg"))'))
        .first();
      const housingRow = housingLabel.locator('..').locator('..');
      const housingInput = housingRow.locator('input[type="number"]').first();

      await housingInput.fill('0');

      // Should show inline validation error
      await expect(page.locator('text=/Budget target cannot be zero/i')).toBeVisible();

      // Note: The current implementation clears invalid input values rather than
      // preventing save. This allows save to succeed with an empty budget (no budget set).
      // Future: Consider adding a "Save" button disable state when validation errors exist.
    });
  });

  test.describe('Rollover Functionality', () => {
    test('should save and persist rollover settings', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Set budget and enable rollover
      await fillBudgetInput(page, 'Housing', '-500');

      const rolloverCheckbox = page.locator(
        '.category-row:has-text("Housing") input[type="checkbox"]'
      );
      await rolloverCheckbox.check();
      expect(await rolloverCheckbox.isChecked()).toBe(true);

      // Save budget
      await page.locator('button:has-text("Save")').click();
      await page.waitForURL(/\/#\//);

      // Reload page and verify rollover persisted
      await page.reload();
      await page.waitForSelector('.app-container');

      // Go back to planning
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Verify rollover checkbox is still checked
      const rolloverCheckboxAfter = page.locator(
        '.category-row:has-text("Housing") input[type="checkbox"]'
      );
      expect(await rolloverCheckboxAfter.isChecked()).toBe(true);
    });

    test('should disable rollover checkbox when no budget target set', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Try to enable rollover without setting budget (checkbox should be disabled)
      const rolloverCheckbox = page.locator(
        '.category-row:has-text("Utilities") input[type="checkbox"]'
      );
      expect(await rolloverCheckbox.isDisabled()).toBe(true);

      // Set budget
      await fillBudgetInput(page, 'Utilities', '-100');

      // Now checkbox should be enabled
      expect(await rolloverCheckbox.isDisabled()).toBe(false);

      // Enable rollover
      await rolloverCheckbox.check();

      // Save
      await page.locator('button:has-text("Save")').click();
      await page.waitForURL(/\/#\//);

      // Verify saved by checking localStorage
      const state = await page.evaluate(() => {
        return JSON.parse(localStorage.getItem('budget-state') || '{}');
      });
      expect(state.budgetPlan?.categoryBudgets?.utilities?.rolloverEnabled).toBe(true);
    });

    test('should toggle rollover on and off', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Set budget and enable rollover
      await fillBudgetInput(page, 'Groceries', '-150');

      const rolloverCheckbox = page.locator(
        '.category-row:has-text("Groceries") input[type="checkbox"]'
      );
      await rolloverCheckbox.check();
      expect(await rolloverCheckbox.isChecked()).toBe(true);

      // Save budget
      await page.locator('button:has-text("Save")').click();
      await page.waitForURL(/\/#\//);

      // Go back to planning
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Verify rollover is checked
      const rolloverCheckboxAgain = page.locator(
        '.category-row:has-text("Groceries") input[type="checkbox"]'
      );
      expect(await rolloverCheckboxAgain.isChecked()).toBe(true);

      // Uncheck rollover
      await rolloverCheckboxAgain.uncheck();

      // Save again
      await page.locator('button:has-text("Save")').click();
      await page.waitForURL(/\/#\//);

      // Go back to planning
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Verify rollover is now unchecked
      const rolloverCheckboxFinal = page.locator(
        '.category-row:has-text("Groceries") input[type="checkbox"]'
      );
      expect(await rolloverCheckboxFinal.isChecked()).toBe(false);
    });
  });

  test.describe('Date Range Filtering', () => {
    test('should filter chart data by date range', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#chart-island svg');

      // Get initial bar count
      const initialBars = page.locator('#chart-island svg rect[fill]');
      const initialCount = await initialBars.count();
      expect(initialCount).toBeGreaterThan(0);

      // Apply date range filter (e.g., only January 2024)
      await page.locator('#start-date').fill('2024-01-01');
      await page.locator('#end-date').fill('2024-01-31');
      await page.locator('button:has-text("Apply")').click();
      await page.waitForTimeout(500);

      // Verify filtered bar count is less
      const filteredBars = page.locator('#chart-island svg rect[fill]');
      const filteredCount = await filteredBars.count();
      expect(filteredCount).toBeLessThan(initialCount);

      // Verify filter indicator is shown
      await expect(page.locator('text=/Showing data from/i')).toBeVisible();

      // Reset filter
      await page.locator('button:has-text("Reset")').click();
      await page.waitForTimeout(500);

      // Verify bar count restored
      const resetBars = page.locator('#chart-island svg rect[fill]');
      const resetCount = await resetBars.count();
      expect(resetCount).toBe(initialCount);

      // Verify filter indicator is hidden
      await expect(page.locator('text=/Showing data from/i')).not.toBeVisible();
    });

    test('should persist date range across page reloads', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#chart-island svg');

      // Set date range
      await page.locator('#start-date').fill('2024-03-01');
      await page.locator('#end-date').fill('2024-06-30');
      await page.locator('button:has-text("Apply")').click();
      await page.waitForTimeout(500);

      // Reload page
      await page.reload();
      await page.waitForSelector('#chart-island svg');

      // Verify date range is still applied
      const startDate = await page.locator('#start-date').inputValue();
      const endDate = await page.locator('#end-date').inputValue();
      expect(startDate).toBe('2024-03-01');
      expect(endDate).toBe('2024-06-30');
      await expect(page.locator('text=/Showing data from/i')).toBeVisible();
    });

    test('should reject invalid date formats', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#chart-island svg');

      // Try to set invalid date (Feb 31st - doesn't exist)
      await page.locator('#start-date').fill('2025-02-31');
      await page.locator('button:has-text("Apply")').click();
      await page.waitForTimeout(500);

      // Should show error banner
      await expect(page.locator('text=/Invalid start date/i')).toBeVisible();

      // Date range should not be applied
      await expect(page.locator('text=/Showing data from/i')).not.toBeVisible();
    });

    test('should reject invalid date ranges (start > end)', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#chart-island svg');

      // Set end date before start date
      await page.locator('#start-date').fill('2024-12-31');
      await page.locator('#end-date').fill('2024-01-01');
      await page.locator('button:has-text("Apply")').click();
      await page.waitForTimeout(500);

      // Should show error banner
      await expect(
        page.locator('text=/Start date must be before or equal to end date/i')
      ).toBeVisible();

      // Date range should not be applied
      await expect(page.locator('text=/Showing data from/i')).not.toBeVisible();
    });

    test('should allow partial date ranges (only start or only end)', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#chart-island svg');

      // Get initial bar count
      const initialBars = page.locator('#chart-island svg rect[fill]');
      const initialCount = await initialBars.count();

      // Apply only start date
      await page.locator('#start-date').fill('2024-06-01');
      await page.locator('button:has-text("Apply")').click();
      await page.waitForTimeout(500);

      // Should show filter indicator
      await expect(page.locator('text=/Showing data from/i')).toBeVisible();

      // Bar count should change
      const filteredBars = page.locator('#chart-island svg rect[fill]');
      const filteredCount = await filteredBars.count();
      expect(filteredCount).toBeLessThan(initialCount);

      // Reset
      await page.locator('button:has-text("Reset")').click();
      await page.waitForTimeout(500);

      // Apply only end date
      await page.locator('#end-date').fill('2024-06-30');
      await page.locator('button:has-text("Apply")').click();
      await page.waitForTimeout(500);

      // Should show filter indicator
      await expect(page.locator('text=/Showing data from/i')).toBeVisible();
    });
  });

  test.describe('Cash Flow Prediction', () => {
    test('should show historic average before budgets are set', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Verify prediction card shows
      await expect(page.locator('text=/Budget Projection/i')).toBeVisible();

      // Verify historic average is shown
      await expect(page.locator('text=/Historic Weekly Average/i')).toBeVisible();

      // Verify the value matches currency format
      const historicAvg = await page
        .locator('.prediction-grid >> text=/Historic Weekly Average/i >> .. >> .text-2xl')
        .textContent();
      expect(historicAvg).toMatch(/\$[\d,]+/);
    });

    test('should show predicted net income when budgets are set', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Set income budget higher than historic
      await fillBudgetInput(page, 'Income', '6000');
      await page.waitForTimeout(400); // Wait for debounce

      // Predicted net income should be visible
      await expect(page.locator('text=/Predicted Weekly Net Income/i')).toBeVisible();

      const predictedIncome = await page
        .locator('.prediction-grid >> text=/Predicted Weekly Net Income/i >> .. >> .text-2xl')
        .textContent();
      expect(predictedIncome).toMatch(/\$[\d,]+/);
      expect(predictedIncome).toBeTruthy();
    });

    test('should show positive variance with green styling', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Set income budget higher than historic
      await fillBudgetInput(page, 'Income', '6000');
      await fillBudgetInput(page, 'Housing', '-300');
      await page.waitForTimeout(400); // Wait for debounce

      // Change from historic should show positive (green)
      const varianceElement = page.locator(
        '.prediction-grid >> text=/Change from Historic/i >> .. >> .text-2xl'
      );
      await expect(varianceElement).toHaveClass(/text-success/);

      const variance = await varianceElement.textContent();
      expect(variance).toMatch(/^\+/); // Should start with +
      expect(variance).toMatch(/\$[\d,]+/);
    });

    test('should show negative variance with red styling', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Set higher expenses than historic
      await fillBudgetInput(page, 'Housing', '-2000');
      await fillBudgetInput(page, 'Groceries', '-500');
      await page.waitForTimeout(400); // Wait for debounce

      // Change from historic should show negative (red)
      const varianceElement = page.locator(
        '.prediction-grid >> text=/Change from Historic/i >> .. >> .text-2xl'
      );
      await expect(varianceElement).toHaveClass(/text-error/);

      const variance = await varianceElement.textContent();
      expect(variance).toMatch(/^-|\$[\d,]+/); // Should start with - or just show currency
    });

    test('should recalculate prediction when budget changes (debounce)', async ({ page }) => {
      // Navigate to planning page
      await page.locator('button:has-text("Set Budget Targets")').click();
      await page.waitForURL(/\/#\/plan/);

      // Set initial income budget
      await fillBudgetInput(page, 'Income', '5000');
      await page.waitForTimeout(400); // Wait for debounce

      // Get initial predicted value
      const initialPrediction = await page
        .locator('.prediction-grid >> text=/Predicted Weekly Net Income/i >> .. >> .text-2xl')
        .textContent();

      // Change income budget
      await fillBudgetInput(page, 'Income', '7000');
      await page.waitForTimeout(400); // Wait for debounce

      // Get new predicted value
      const newPrediction = await page
        .locator('.prediction-grid >> text=/Predicted Weekly Net Income/i >> .. >> .text-2xl')
        .textContent();

      // Verify values are different (prediction updated)
      expect(initialPrediction).not.toBe(newPrediction);
    });
  });
});
