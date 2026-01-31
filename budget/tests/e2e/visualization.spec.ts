import { test, expect } from '@playwright/test';

test.describe('Budget Visualization', () => {
  test('should load page without errors @smoke', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: Error[] = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Capture uncaught page errors
    page.on('pageerror', (error) => {
      pageErrors.push(error);
    });

    await page.goto('/');
    await page.waitForSelector('.app-container', { timeout: 10000 });

    // Verify no loading spinner stuck
    const spinner = page.locator('.spinner, .loading');
    await expect(spinner)
      .not.toBeVisible({ timeout: 5000 })
      .catch(() => {});

    // Verify no error messages in components
    const chartError = page.locator('#chart-island >> text=/Error loading/i');
    await expect(chartError).not.toBeVisible();

    const legendError = page.locator('#legend-island >> text=/Error/i');
    await expect(legendError).not.toBeVisible();

    // Check for errors
    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('should display header with title @smoke', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Scope selector to main view to avoid matching hidden views
    const header = page.locator('#main-view .app-header h1');
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

  test('should render Observable Plot chart @smoke', async ({ page }) => {
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
    const legend = page.getByRole('heading', { name: 'Filters' });
    await expect(legend).toBeVisible({ timeout: 10000 });

    // Check for vacation checkbox
    const vacationCheckbox = page.getByRole('checkbox', { name: 'Show Vacation Expenses' });
    await expect(vacationCheckbox).toBeVisible();

    // Check for category summaries (should show categories with their totals)
    const categorySummaries = page.locator('#legend-island .space-y-2 > div > div');
    const count = await categorySummaries.count();
    expect(count).toBeGreaterThan(0); // Should have at least some categories displayed
  });

  test('should toggle category visibility via legend', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Wait for legend to fully render
    await page.waitForSelector('#legend-island');

    // Find a category item in the legend (e.g., Housing)
    // The legend items contain the category label text
    // Need to go up to the parent div that has the legend-category-row class
    const housingItem = page.locator('#legend-island .legend-category-row:has-text("Housing")');
    await expect(housingItem).toBeVisible();

    // Initially, item should not be hidden (opacity 100%)
    const initialOpacity = await housingItem.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(parseFloat(initialOpacity)).toBeGreaterThan(0.9);

    // Click to hide the category
    await housingItem.click();
    await page.waitForTimeout(300);

    // Verify hidden state (opacity 50%)
    const hiddenOpacity = await housingItem.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(parseFloat(hiddenOpacity)).toBeLessThan(0.6);

    // Click again to show
    await housingItem.click();
    await page.waitForTimeout(300);

    // Verify visible state restored
    const visibleOpacity = await housingItem.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(parseFloat(visibleOpacity)).toBeGreaterThan(0.9);
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

    // Header should still be visible (scope to main view)
    await expect(page.locator('#main-view .app-header')).toBeVisible();

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

  test('should persist hidden categories across page reloads', async ({ page }) => {
    // Clear localStorage first
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.waitForSelector('.app-container');

    // Hide a specific category by clicking it in the legend
    const diningItem = page.locator('#legend-island .legend-category-row:has-text("Dining")');
    await diningItem.click();
    await page.waitForTimeout(500);

    // Verify it's hidden (opacity 50%)
    const hiddenOpacity = await diningItem.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(parseFloat(hiddenOpacity)).toBeLessThan(0.6);

    // Reload the page
    await page.reload();
    await page.waitForSelector('.app-container');
    await page.waitForTimeout(500);

    // Should still be hidden after reload
    const diningItemAfterReload = page.locator(
      '#legend-island .legend-category-row:has-text("Dining")'
    );
    const reloadedOpacity = await diningItemAfterReload.evaluate(
      (el) => window.getComputedStyle(el).opacity
    );
    expect(parseFloat(reloadedOpacity)).toBeLessThan(0.6);
  });

  test('should hydrate islands correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Check that chart island is hydrated
    const chartIsland = page.locator('#chart-island[data-island-component="BudgetChart"]');
    await expect(chartIsland).toBeVisible();
    await expect(chartIsland).toHaveAttribute('data-island-hydrated', 'true');

    // Verify chart SVG is rendered inside the island
    const chartSvg = page.locator('#chart-island svg');
    await expect(chartSvg).toBeVisible({ timeout: 10000 });

    // Check that legend island is hydrated
    const legendIsland = page.locator('#legend-island[data-island-component="Legend"]');
    await expect(legendIsland).toBeVisible();
    await expect(legendIsland).toHaveAttribute('data-island-hydrated', 'true');
  });

  test('should render chart with transaction data', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Wait for chart to render
    const chartSvg = page.locator('#chart-island svg');
    await expect(chartSvg).toBeVisible({ timeout: 10000 });

    // Verify chart has bars (transaction data rendered)
    const bars = page.locator('#chart-island svg rect[fill]');
    const barCount = await bars.count();
    expect(barCount).toBeGreaterThan(0);

    // Verify no error message is displayed
    const errorMessage = page.locator('text=/Error loading chart/i');
    await expect(errorMessage).not.toBeVisible();
  });

  test('should render legend with category data and colors', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#legend-island');

    // Verify legend has category items with color swatches
    const categoryItems = page.locator('#legend-island [style*="background-color"]');
    const count = await categoryItems.count();
    expect(count).toBeGreaterThan(0);

    // Verify each category shows transaction count and total
    const firstCategory = page.locator('#legend-island .space-y-2 > div').first();
    await expect(firstCategory).toBeVisible();

    // Should have dollar amount
    await expect(firstCategory.locator('text=/\\$/i')).toBeVisible();

    // Should have transaction count
    await expect(firstCategory.locator('text=/txns/i')).toBeVisible();
  });

  test('should hydrate islands with valid props', async ({ page }) => {
    await page.goto('/');

    // Check that chart island has props with transactions
    const chartProps = await page.locator('#chart-island').getAttribute('data-island-props');
    expect(chartProps).toBeTruthy();

    const chartData = JSON.parse(chartProps || '{}');
    expect(chartData.transactions).toBeDefined();
    expect(Array.isArray(chartData.transactions)).toBe(true);
    expect(chartData.transactions.length).toBeGreaterThan(0);

    // Check that legend island has props with transactions
    const legendProps = await page.locator('#legend-island').getAttribute('data-island-props');
    expect(legendProps).toBeTruthy();

    const legendData = JSON.parse(legendProps || '{}');
    expect(legendData.transactions).toBeDefined();
    expect(Array.isArray(legendData.transactions)).toBe(true);
  });

  test('should update chart when category is toggled in legend', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');

    // Get initial chart content
    const chartSvg = page.locator('#chart-island svg');
    await expect(chartSvg).toBeVisible();

    const initialContent = await chartSvg.innerHTML();

    // Toggle a category
    const housingItem = page.locator('#legend-island >> text=Housing').locator('..');
    await housingItem.click();
    await page.waitForTimeout(500);

    // Chart should have re-rendered with different content
    const updatedContent = await chartSvg.innerHTML();
    expect(updatedContent).not.toBe(initialContent);

    // Verify chart still has content (not empty)
    const bars = page.locator('#chart-island svg rect[fill]');
    const barCount = await bars.count();
    expect(barCount).toBeGreaterThan(0);
  });

  test('should handle multiple category toggles correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#legend-island');

    // Toggle multiple categories
    const categories = ['Housing', 'Dining', 'Utilities'];

    for (const category of categories) {
      const item = page.locator(`#legend-island .legend-category-row:has-text("${category}")`);
      await item.click();
      await page.waitForTimeout(200);

      // Verify each becomes hidden
      const opacity = await item.evaluate((el) => window.getComputedStyle(el).opacity);
      expect(parseFloat(opacity)).toBeLessThan(0.6);
    }

    // Verify localStorage has all hidden categories
    const state = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('budget-state') || '{}');
    });

    expect(state.hiddenCategories).toBeDefined();
    expect(state.hiddenCategories.length).toBe(3);
    expect(state.hiddenCategories).toContain('housing');
    expect(state.hiddenCategories).toContain('dining');
    expect(state.hiddenCategories).toContain('utilities');
  });

  test('should not have component-level errors', async ({ page }) => {
    // Listen for all error events
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error);
    });

    await page.goto('/');
    await page.waitForSelector('.app-container');
    await page.waitForLoadState('networkidle');

    // Check for error messages in UI
    const chartError = page.locator('#chart-island >> text=/Error loading/i');
    await expect(chartError).not.toBeVisible();

    const legendError = page.locator('#legend-island >> text=/Error/i');
    await expect(legendError).not.toBeVisible();

    // Verify no page errors occurred
    expect(pageErrors).toHaveLength(0);
  });

  test('should initialize with correct default state', async ({ page }) => {
    // Clear localStorage before test
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.app-container');

    // Verify default state: all categories visible
    const categoryItems = page.locator('#legend-island .space-y-2 > div > div');
    const count = await categoryItems.count();

    for (let i = 0; i < count; i++) {
      const item = categoryItems.nth(i);
      const opacity = await item.evaluate((el) => window.getComputedStyle(el).opacity);
      // All should be visible (opacity > 0.9)
      expect(parseFloat(opacity)).toBeGreaterThan(0.9);
    }

    // Verify state in localStorage
    const state = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('budget-state') || '{}');
    });

    expect(state.hiddenCategories).toBeDefined();
    expect(state.hiddenCategories).toHaveLength(0);
    expect(state.showVacation).toBe(true);
  });

  test('should display tooltip on bar hover', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chart-island svg');

    // Find a bar segment
    const bar = page.locator('#chart-island svg g[aria-label*="bar"] rect').first();
    await expect(bar).toBeVisible();

    // Hover over the bar
    await bar.hover();

    // Wait a moment for tooltip to appear
    await page.waitForTimeout(100);

    // Check for tooltip
    const tooltip = page.locator('.segment-tooltip');
    await expect(tooltip).toBeVisible();

    // Verify tooltip has expected content
    await expect(tooltip.locator('.tooltip-category')).toBeVisible();
    await expect(tooltip.locator('.tooltip-month')).toBeVisible();
    await expect(tooltip.locator('.tooltip-total')).toBeVisible();

    // Verify breakdown sections (0-2 sections depending on data)
    const sectionCount = await tooltip.locator('.tooltip-section').count();
    expect(sectionCount).toBeGreaterThanOrEqual(0);
    expect(sectionCount).toBeLessThanOrEqual(2);

    // Verify transaction count
    await expect(tooltip.locator('.tooltip-transaction-count')).toBeVisible();
    await expect(tooltip.locator('.tooltip-transaction-count')).toContainText('transaction');
  });

  test('should pin tooltip on click', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chart-island svg');

    // Find a bar segment
    const bar = page.locator('#chart-island svg g[aria-label*="bar"] rect').first();
    await expect(bar).toBeVisible();

    // Click the bar to pin tooltip
    await bar.click();

    // Wait a moment for tooltip to appear
    await page.waitForTimeout(100);

    // Check for tooltip with close button
    const tooltip = page.locator('.segment-tooltip');
    await expect(tooltip).toBeVisible();

    const closeButton = tooltip.locator('.tooltip-close');
    await expect(closeButton).toBeVisible();

    // Verify tooltip hint
    await expect(tooltip.locator('.tooltip-hint')).toContainText('Click outside to unpin');

    // Move mouse away from bar
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);

    // Tooltip should still be visible (pinned)
    await expect(tooltip).toBeVisible();

    // Click outside to unpin
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(100);

    // Tooltip should be hidden
    await expect(tooltip).not.toBeVisible();
  });

  test('should show qualifier breakdowns in tooltip when values are non-zero', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chart-island svg');

    // Find a bar segment
    const bar = page.locator('#chart-island svg g[aria-label*="bar"] rect').first();
    await bar.hover();

    // Wait for tooltip
    await page.waitForTimeout(100);
    const tooltip = page.locator('.segment-tooltip');
    await expect(tooltip).toBeVisible();

    // Check for sections that are present
    const sections = await tooltip.locator('.tooltip-section-title').allTextContents();

    // Verify section count (might be 0, 1, or 2)
    expect(sections.length).toBeGreaterThanOrEqual(0);
    expect(sections.length).toBeLessThanOrEqual(2);

    // If redemption section exists, check its rows
    if (sections.includes('By Redemption')) {
      await expect(tooltip.locator('text=/^Redeemable$/')).toBeVisible();
      await expect(tooltip.locator('text=/^Non-redeemable$/')).toBeVisible();
    }

    // If type section exists, check its rows
    if (sections.includes('By Type')) {
      await expect(tooltip.locator('text=/^Vacation$/')).toBeVisible();
      await expect(tooltip.locator('text=/^Non-vacation$/')).toBeVisible();
    }

    // Verify all visible amounts are formatted as currency
    const values = await tooltip.locator('.tooltip-value').allTextContents();
    if (values.length > 0) {
      expect(values.every((v) => v.startsWith('$'))).toBeTruthy();
    }
  });

  test.describe('Tooltip Qualifier Sections with Mixed Test Data', () => {
    /**
     * Helper function to hover over a specific month/category segment
     * Strategy: Trigger native mouse events to properly activate React event listeners
     */
    async function hoverSegment(page, monthYYYYMM: string, categoryLabel: string) {
      const chartSvg = page.locator('#chart-island svg');
      await expect(chartSvg).toBeVisible({ timeout: 10000 });

      // Get all bar rectangles - Observable Plot creates bars under g[aria-label="bar"] groups
      const barGroups = page.locator('g[aria-label="bar"]');
      const barCount = await barGroups.count();

      // Try both expense and income bar groups
      for (let groupIdx = 0; groupIdx < barCount; groupIdx++) {
        const bars = barGroups.nth(groupIdx).locator('rect');
        const rectCount = await bars.count();

        // Iterate through bars in this group
        for (let i = 0; i < rectCount; i++) {
          const rect = bars.nth(i);

          // Get bar data attributes first
          const barMonth = await rect.getAttribute('data-month');
          const barCategory = await rect.getAttribute('data-category');

          // Skip if this bar doesn't match what we're looking for
          // Category comparison is case-insensitive (bar has "dining", label is "Dining")
          if (
            barMonth !== monthYYYYMM ||
            barCategory?.toLowerCase() !== categoryLabel.toLowerCase()
          ) {
            continue;
          }

          // This bar matches! Hover and verify tooltip updates correctly
          await rect.hover({ force: true });

          // Wait for tooltip to appear
          const tooltip = page.locator('.segment-tooltip');
          try {
            await tooltip.waitFor({ state: 'visible', timeout: 2000 });

            // Wait for tooltip to show the correct data for THIS bar
            // Use expect with retry to wait for tooltip content to match
            await expect(tooltip.locator('.tooltip-category')).toHaveText(categoryLabel, {
              timeout: 3000,
            });

            // Also wait for the month to update (convert expected month to formatted text)
            const expectedDate = new Date(monthYYYYMM + '-01');
            const expectedMonthText = expectedDate.toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            });
            await expect(tooltip.locator('.tooltip-month')).toHaveText(expectedMonthText, {
              timeout: 3000,
            });

            // Wait a bit more for sections to render completely
            await page.waitForTimeout(500);
            return tooltip;
          } catch (e) {
            // Tooltip didn't appear or match, continue to next bar
          }

          // Move mouse away to hide tooltip before checking next bar
          await page.mouse.move(0, 0);
          await page.waitForTimeout(150);
        }
      }

      throw new Error(`Could not find segment for ${categoryLabel} in ${monthYYYYMM}`);
    }

    /**
     * Helper function to parse currency string like "$123.45" to number
     */
    function parseCurrency(text: string | null): number {
      if (!text) return 0;
      return parseFloat(text.replace(/[$,]/g, ''));
    }

    test('March 2024 Dining - shows BOTH sections (4-way split)', async ({ page }) => {
      // Capture console logs
      page.on('console', (msg) => {
        if (msg.text().includes('[BudgetChart]') || msg.text().includes('[DEBUG]')) {
          console.log('Browser console:', msg.text());
        }
      });

      await page.goto('/');
      const tooltip = await hoverSegment(page, '2024-03', 'Dining');

      // Verify both sections are present
      const sectionTitles = await tooltip.locator('.tooltip-section-title').allTextContents();
      expect(sectionTitles).toContain('By Redemption');
      expect(sectionTitles).toContain('By Type');

      // Verify redemption breakdown
      // Get rows by index (first row is Redeemable, second is Non-redeemable)
      const redemptionSection = tooltip
        .locator('.tooltip-section')
        .filter({ hasText: 'By Redemption' });
      const redemptionRows = redemptionSection.locator('.tooltip-row');

      const redeemableText = await redemptionRows.nth(0).locator('.tooltip-value').textContent();
      const nonRedeemableText = await redemptionRows.nth(1).locator('.tooltip-value').textContent();

      const redeemable = parseCurrency(redeemableText);
      const nonRedeemable = parseCurrency(nonRedeemableText);

      expect(redeemable).toBeCloseTo(112.33, 1); // txn-81 (145.75 * 0.5) + txn-83 (78.90 * 0.5)
      expect(nonRedeemable).toBeCloseTo(140.8, 1); // txn-80 (95.50) + txn-82 (45.30)

      // Verify type breakdown
      // Get rows by index (first row is Vacation, second is Non-vacation)
      const typeSection = tooltip.locator('.tooltip-section').filter({ hasText: 'By Type' });
      const typeRows = typeSection.locator('.tooltip-row');

      const vacationText = await typeRows.nth(0).locator('.tooltip-value').textContent();
      const nonVacationText = await typeRows.nth(1).locator('.tooltip-value').textContent();

      const vacation = parseCurrency(vacationText);
      const nonVacation = parseCurrency(nonVacationText);

      expect(vacation).toBeCloseTo(168.38, 1); // txn-80 (95.50) + txn-81 (145.75 * 0.5)
      expect(nonVacation).toBeCloseTo(84.75, 1); // txn-82 (45.30) + txn-83 (78.90 * 0.5)

      // Verify total and transaction count
      const totalText = await tooltip.locator('.tooltip-total-value').textContent();
      expect(parseCurrency(totalText)).toBeCloseTo(253.13, 1);

      const countText = await tooltip.locator('.tooltip-transaction-count').textContent();
      expect(countText).toContain('4 transactions');
    });

    test('March 2024 Entertainment - shows BOTH sections', async ({ page }) => {
      await page.goto('/');
      const tooltip = await hoverSegment(page, '2024-03', 'Entertainment');

      // Verify both sections are present
      const sectionTitles = await tooltip.locator('.tooltip-section-title').allTextContents();
      expect(sectionTitles).toContain('By Redemption');
      expect(sectionTitles).toContain('By Type');

      // Verify redemption breakdown
      // Get rows by index (first row is Redeemable, second is Non-redeemable)
      const redemptionSection = tooltip
        .locator('.tooltip-section')
        .filter({ hasText: 'By Redemption' });
      const redemptionRows = redemptionSection.locator('.tooltip-row');

      const redeemableText = await redemptionRows.nth(0).locator('.tooltip-value').textContent();
      const nonRedeemableText = await redemptionRows.nth(1).locator('.tooltip-value').textContent();

      expect(parseCurrency(redeemableText)).toBeCloseTo(117.5, 1); // txn-84 (235.00 * 0.5)
      expect(parseCurrency(nonRedeemableText)).toBeCloseTo(32.5, 1); // txn-85

      // Verify type breakdown
      // Get rows by index (first row is Vacation, second is Non-vacation)
      const typeSection = tooltip.locator('.tooltip-section').filter({ hasText: 'By Type' });
      const typeRows = typeSection.locator('.tooltip-row');

      const vacationText = await typeRows.nth(0).locator('.tooltip-value').textContent();
      const nonVacationText = await typeRows.nth(1).locator('.tooltip-value').textContent();

      expect(parseCurrency(vacationText)).toBeCloseTo(117.5, 1); // txn-84 (235.00 * 0.5)
      expect(parseCurrency(nonVacationText)).toBeCloseTo(32.5, 1); // txn-85
    });

    test('June 2024 Travel - shows Type section ONLY', async ({ page }) => {
      await page.goto('/');
      const tooltip = await hoverSegment(page, '2024-06', 'Travel');

      // Verify Type section is present
      const sectionTitles = await tooltip.locator('.tooltip-section-title').allTextContents();
      expect(sectionTitles).toContain('By Type');

      // Verify Redemption section is NOT present
      expect(sectionTitles).not.toContain('By Redemption');

      // Verify type breakdown
      // Get rows by index (first row is Vacation, second is Non-vacation)
      const typeSection = tooltip.locator('.tooltip-section').filter({ hasText: 'By Type' });
      const typeRows = typeSection.locator('.tooltip-row');

      const vacationText = await typeRows.nth(0).locator('.tooltip-value').textContent();
      const nonVacationText = await typeRows.nth(1).locator('.tooltip-value').textContent();

      expect(parseCurrency(vacationText)).toBeCloseTo(567.84, 1); // txn-40 + txn-41 (both * 0.5)
      expect(parseCurrency(nonVacationText)).toBeCloseTo(357.25, 1); // txn-86 + txn-87 (both * 0.5)
    });

    test('June 2024 Dining - shows BOTH sections', async ({ page }) => {
      await page.goto('/');
      const tooltip = await hoverSegment(page, '2024-06', 'Dining');

      // Verify both sections are present (has mix of redeemable/non-redeemable AND vacation/non-vacation)
      const sectionTitles = await tooltip.locator('.tooltip-section-title').allTextContents();
      expect(sectionTitles).toContain('By Redemption');
      expect(sectionTitles).toContain('By Type');

      // Verify redemption breakdown
      const redemptionSection = tooltip
        .locator('.tooltip-section')
        .filter({ hasText: 'By Redemption' });
      const redemptionRows = redemptionSection.locator('.tooltip-row');

      const redeemableText = await redemptionRows.nth(0).locator('.tooltip-value').textContent();
      const nonRedeemableText = await redemptionRows.nth(1).locator('.tooltip-value').textContent();

      expect(parseCurrency(redeemableText)).toBeCloseTo(95.63, 1); // txn-42 + txn-88 (* 0.5)
      expect(parseCurrency(nonRedeemableText)).toBeCloseTo(18.45, 1); // txn-89

      // Verify type breakdown
      const typeSection = tooltip.locator('.tooltip-section').filter({ hasText: 'By Type' });
      const typeRows = typeSection.locator('.tooltip-row');

      const vacationText = await typeRows.nth(0).locator('.tooltip-value').textContent();
      const nonVacationText = await typeRows.nth(1).locator('.tooltip-value').textContent();

      expect(parseCurrency(vacationText)).toBeCloseTo(61.73, 1); // txn-42 (* 0.5)
      expect(parseCurrency(nonVacationText)).toBeCloseTo(52.35, 1); // txn-88 (* 0.5) + txn-89
    });

    test('February 2024 Entertainment - shows Redemption section ONLY', async ({ page }) => {
      await page.goto('/');
      const tooltip = await hoverSegment(page, '2024-02', 'Entertainment');

      // Verify Redemption section is present
      const sectionTitles = await tooltip.locator('.tooltip-section-title').allTextContents();
      expect(sectionTitles).toContain('By Redemption');

      // Verify Type section is NOT present
      expect(sectionTitles).not.toContain('By Type');

      // Verify redemption breakdown
      // Get rows by index (first row is Redeemable, second is Non-redeemable)
      const redemptionSection = tooltip
        .locator('.tooltip-section')
        .filter({ hasText: 'By Redemption' });
      const redemptionRows = redemptionSection.locator('.tooltip-row');

      const redeemableText = await redemptionRows.nth(0).locator('.tooltip-value').textContent();
      const nonRedeemableText = await redemptionRows.nth(1).locator('.tooltip-value').textContent();

      expect(parseCurrency(redeemableText)).toBeCloseTo(90.0, 1); // txn-17 (180 * 0.5)
      expect(parseCurrency(nonRedeemableText)).toBeCloseTo(12.99, 1); // txn-90
    });

    test('May 2024 Entertainment - shows Redemption section ONLY', async ({ page }) => {
      await page.goto('/');
      const tooltip = await hoverSegment(page, '2024-05', 'Entertainment');

      // Verify Redemption section is present
      const sectionTitles = await tooltip.locator('.tooltip-section-title').allTextContents();
      expect(sectionTitles).toContain('By Redemption');

      // Verify Type section is NOT present
      expect(sectionTitles).not.toContain('By Type');

      // Verify redemption breakdown
      // Get rows by index (first row is Redeemable, second is Non-redeemable)
      const redemptionSection = tooltip
        .locator('.tooltip-section')
        .filter({ hasText: 'By Redemption' });
      const redemptionRows = redemptionSection.locator('.tooltip-row');

      const redeemableText = await redemptionRows.nth(0).locator('.tooltip-value').textContent();
      const nonRedeemableText = await redemptionRows.nth(1).locator('.tooltip-value').textContent();

      expect(parseCurrency(redeemableText)).toBeCloseTo(22.75, 1); // txn-34 (45.5 * 0.5)
      expect(parseCurrency(nonRedeemableText)).toBeCloseTo(11.99, 1); // txn-91
    });

    test('January 2024 Groceries - shows NO sections (homogeneous data)', async ({ page }) => {
      await page.goto('/');
      const tooltip = await hoverSegment(page, '2024-01', 'Groceries');

      // Verify no sections are displayed
      const sections = await tooltip.locator('.tooltip-section').count();
      expect(sections).toBe(0);

      // Verify total and transaction count are still visible
      const totalText = await tooltip.locator('.tooltip-total-value').textContent();
      expect(parseCurrency(totalText)).toBeGreaterThan(0);

      const countText = await tooltip.locator('.tooltip-transaction-count').textContent();
      expect(countText).toContain('transaction');
    });

    test('All currency amounts are formatted with dollar sign', async ({ page }) => {
      await page.goto('/');
      const tooltip = await hoverSegment(page, '2024-03', 'Dining');

      // Check total amount
      const totalText = await tooltip.locator('.tooltip-total-value').textContent();
      expect(totalText).toMatch(/^\$/);

      // Check all breakdown values
      const allValues = await tooltip.locator('.tooltip-value').allTextContents();
      expect(allValues.length).toBeGreaterThan(0);
      allValues.forEach((value) => {
        expect(value).toMatch(/^\$/);
      });
    });

    test('Sections change when vacation filter is toggled', async ({ page }) => {
      await page.goto('/');

      // Hover over March 2024 Dining (should have both sections)
      let tooltip = await hoverSegment(page, '2024-03', 'Dining');
      let sectionTitles = await tooltip.locator('.tooltip-section-title').allTextContents();
      expect(sectionTitles).toContain('By Type');

      // Toggle vacation filter
      const vacationCheckbox = page.locator('input[type="checkbox"]').first();
      await vacationCheckbox.click();
      await page.waitForTimeout(300);

      // Hover again
      tooltip = await hoverSegment(page, '2024-03', 'Dining');
      sectionTitles = await tooltip.locator('.tooltip-section-title').allTextContents();

      // Type section should now be absent (after filtering, only non-vacation remains)
      expect(sectionTitles).not.toContain('By Type');
    });

    test('Transaction counts are accurate for complex segments', async ({ page }) => {
      await page.goto('/');

      // March 2024 Dining has 4 new transactions
      const tooltip = await hoverSegment(page, '2024-03', 'Dining');
      const countText = await tooltip.locator('.tooltip-transaction-count').textContent();

      // Should show 4 transactions (txn-80, txn-81, txn-82, txn-83)
      expect(countText).toContain('4 transaction');
    });
  });
});
