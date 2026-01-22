import { test, expect } from '@playwright/test';

test.describe('Router Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');
  });

  test('should handle browser back/forward buttons correctly', async ({ page }) => {
    // Initial state: main view
    await expect(page).toHaveURL(/\/#\//);

    // Navigate to planning page
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Verify planning page is rendered
    const planningHeading = page.locator('h1, h2').filter({ hasText: /Budget Planning/i });
    await expect(planningHeading).toBeVisible();

    // Use browser back button
    await page.goBack();
    await page.waitForURL(/\/#\//);

    // Verify main view is rendered (chart should be visible)
    await expect(page.locator('#chart-island svg')).toBeVisible();

    // Use browser forward button
    await page.goForward();
    await page.waitForURL(/\/#\/plan/);

    // Verify planning page is rendered again
    await expect(planningHeading).toBeVisible();
  });

  test('should support direct URL access to planning page', async ({ page }) => {
    // Access planning page directly via URL hash
    await page.goto('/#/plan');
    await page.waitForSelector('.app-container');

    // Verify planning page is rendered
    const planningHeading = page.locator('h1, h2').filter({ hasText: /Budget Planning/i });
    await expect(planningHeading).toBeVisible();

    // Verify planning-specific elements are visible
    const housingInput = page
      .locator('.category-row', { hasText: 'Housing' })
      .locator('input[type="number"]');
    await expect(housingInput).toBeVisible();
  });

  test('should support direct URL access to main page', async ({ page }) => {
    // Access main page directly via URL hash
    await page.goto('/#/');
    await page.waitForSelector('.app-container');

    // Verify chart is rendered
    await expect(page.locator('#chart-island svg')).toBeVisible();

    // Verify legend is rendered
    await expect(page.locator('#legend-island')).toBeVisible();
  });

  test('should preserve chart state when navigating to planning and back', async ({ page }) => {
    // Hide a category in the legend
    const housingItem = page.locator('#legend-island .legend-category-row:has-text("Housing")');
    await housingItem.click();
    await page.waitForTimeout(300);

    // Verify Housing is hidden (reduced opacity)
    const opacityBefore = await housingItem.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(parseFloat(opacityBefore)).toBeLessThan(0.6);

    // Navigate to planning page
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Navigate back to main view
    const cancelButton = page.locator('button:has-text("Cancel")');
    await cancelButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(300);

    // Verify Housing is still hidden
    const housingItemAfter = page.locator(
      '#legend-island .legend-category-row:has-text("Housing")'
    );
    const opacityAfter = await housingItemAfter.evaluate(
      (el) => window.getComputedStyle(el).opacity
    );
    expect(parseFloat(opacityAfter)).toBeLessThan(0.6);
  });

  test('should handle invalid hash values gracefully', async ({ page }) => {
    // Navigate to invalid hash
    await page.goto('/#/invalid-route');
    await page.waitForSelector('.app-container');

    // Should default to main view (chart should be visible)
    await expect(page.locator('#chart-island svg')).toBeVisible();

    // URL should remain as-is (router doesn't force redirect)
    await expect(page).toHaveURL(/\/#\/invalid-route/);
  });

  test('should handle malformed hash values gracefully', async ({ page }) => {
    // Navigate to malformed hash
    await page.goto('/#plan'); // Missing leading slash
    await page.waitForSelector('.app-container');

    // Router should normalize '#plan' to '/plan' route
    const planningHeading = page.locator('h1, h2').filter({ hasText: /Budget Planning/i });
    await expect(planningHeading).toBeVisible();
  });

  test('should navigate from planning to main via Cancel button', async ({ page }) => {
    // Navigate to planning page
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Click Cancel button
    const cancelButton = page.locator('button:has-text("Cancel")');
    await cancelButton.click();
    await page.waitForURL(/\/#\//);

    // Verify main view is rendered
    await expect(page.locator('#chart-island svg')).toBeVisible();
  });

  test('should navigate from planning to main via Save button', async ({ page }) => {
    // Navigate to planning page
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Click Save button (even without changes)
    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//);

    // Verify main view is rendered
    await expect(page.locator('#chart-island svg')).toBeVisible();
  });

  test('should preserve date range filter when navigating', async ({ page }) => {
    // Set date range filter
    const startDateInput = page.locator('input[type="date"]').first();
    const endDateInput = page.locator('input[type="date"]').last();

    await startDateInput.fill('2025-01-01');
    await endDateInput.fill('2025-03-31');
    await page.waitForTimeout(500); // Wait for chart re-render

    // Navigate to planning page
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Navigate back
    const cancelButton = page.locator('button:has-text("Cancel")');
    await cancelButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(300);

    // Verify date range is preserved
    const startValue = await startDateInput.inputValue();
    const endValue = await endDateInput.inputValue();
    expect(startValue).toBe('2025-01-01');
    expect(endValue).toBe('2025-03-31');
  });

  test('should preserve bar aggregation when navigating', async ({ page }) => {
    // Switch to weekly bars
    const weeklyButton = page.locator('button:has-text("Weekly Bars")');
    await weeklyButton.click();
    await page.waitForTimeout(500);

    // Navigate to planning page
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/);

    // Navigate back
    const cancelButton = page.locator('button:has-text("Cancel")');
    await cancelButton.click();
    await page.waitForURL(/\/#\//);
    await page.waitForTimeout(300);

    // Verify weekly bars button has primary styling (indicating it's selected)
    const buttonClass = await weeklyButton.getAttribute('class');
    expect(buttonClass).toContain('btn-primary');
  });
});
