import { test, expect } from '@playwright/test';

test.describe('Chart Rendering Debug', () => {
  test('capture screenshots of chart states', async ({ page }) => {
    await page.goto('http://localhost:5173/');

    // Wait for initial chart render
    await page.waitForTimeout(1000);

    // Screenshot 1: Initial stacked mode
    await page.screenshot({
      path: 'tmp/1-initial-stacked.png',
      fullPage: true,
    });

    // Check console for errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
        console.log('❌ Console Error:', msg.text());
      }
    });

    page.on('pageerror', (err) => {
      errors.push(err.message);
      console.log('❌ Page Error:', err.message);
    });

    // Navigate to Plan Budget
    await page.locator('button:has-text("Plan Budget")').click();
    await page.waitForTimeout(500);

    // Screenshot 2: Plan Budget page
    await page.screenshot({
      path: 'tmp/2-plan-budget-page.png',
      fullPage: true,
    });

    // Set budget for Housing
    const housingInput = page.locator('input[name="housing-budget"]');
    await housingInput.fill('500');

    // Set budget for Groceries
    const groceriesInput = page.locator('input[name="groceries-budget"]');
    await groceriesInput.fill('150');

    // Save budgets
    await page.locator('button:has-text("Save")').click();
    await page.waitForTimeout(1000);

    // Screenshot 3: After saving budgets
    await page.screenshot({
      path: 'tmp/3-after-save-budgets.png',
      fullPage: true,
    });

    // Enable Housing indicator
    const housingIndicatorBtn = page.locator(
      '.legend-category-row:has-text("Housing") button:has-text("📊")'
    );
    console.log('Housing indicator button count:', await housingIndicatorBtn.count());
    await housingIndicatorBtn.click();
    await page.waitForTimeout(1000);

    // Screenshot 4: After enabling Housing indicator
    await page.screenshot({
      path: 'tmp/4-housing-indicator-enabled.png',
      fullPage: true,
    });

    // Check chart SVG
    const chartSvg = page.locator('#chart-island svg');
    const svgExists = (await chartSvg.count()) > 0;
    console.log('Chart SVG exists:', svgExists);

    // Count bar groups
    const barGroups = page.locator('#chart-island svg g[aria-label="bar"]');
    const barGroupCount = await barGroups.count();
    console.log('Bar groups count:', barGroupCount);

    // Count all rects
    const allRects = page.locator('#chart-island svg rect[fill]');
    const rectCount = await allRects.count();
    console.log('Total rects count:', rectCount);

    // Enable Groceries indicator
    const groceriesIndicatorBtn = page.locator(
      '.legend-category-row:has-text("Groceries") button:has-text("📊")'
    );
    console.log('Groceries indicator button count:', await groceriesIndicatorBtn.count());
    await groceriesIndicatorBtn.click();
    await page.waitForTimeout(1000);

    // Screenshot 5: After enabling both indicators
    await page.screenshot({
      path: 'tmp/5-both-indicators-enabled.png',
      fullPage: true,
    });

    // Re-check counts
    const barGroupCount2 = await barGroups.count();
    console.log('Bar groups count (2 indicators):', barGroupCount2);

    const rectCount2 = await allRects.count();
    console.log('Total rects count (2 indicators):', rectCount2);

    // Disable all indicators
    await housingIndicatorBtn.click();
    await page.waitForTimeout(500);
    await groceriesIndicatorBtn.click();
    await page.waitForTimeout(1000);

    // Screenshot 6: Back to stacked mode
    await page.screenshot({
      path: 'tmp/6-back-to-stacked.png',
      fullPage: true,
    });

    // Final error check
    console.log('\n=== ERROR SUMMARY ===');
    console.log('Total errors:', errors.length);
    if (errors.length > 0) {
      console.log('Errors:', errors);
    }
  });
});
