import { test } from '@playwright/test';

test.use({ browserName: 'firefox' });

test('visual verification - grouped bars', async ({ page }) => {
  // Navigate to budget dashboard
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);

  // Capture initial state
  await page.screenshot({ path: 'test-results/01-initial.png', fullPage: true });
  console.log('✓ Captured initial state');

  // Go to Plan Budget page
  await page.click('button:has-text("Plan Budget")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/02-plan-budget.png', fullPage: true });
  console.log('✓ Captured plan budget page');

  // Set Housing budget
  await page.fill('input[name="housing-budget"]', '500');

  // Set Groceries budget
  await page.fill('input[name="groceries-budget"]', '150');

  await page.screenshot({ path: 'test-results/03-budgets-entered.png', fullPage: true });
  console.log('✓ Budgets entered');

  // Save budgets
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'test-results/04-after-save.png', fullPage: true });
  console.log('✓ Budgets saved');

  // Enable Housing indicator only
  console.log('Enabling Housing indicator...');
  await page.click('.legend-category-row:has-text("Housing") button:has-text("📊")');
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'test-results/05-housing-only.png', fullPage: true });
  console.log('✓ Housing indicator enabled (1 category)');

  // Enable Groceries indicator (2 categories)
  console.log('Enabling Groceries indicator...');
  await page.click('.legend-category-row:has-text("Groceries") button:has-text("📊")');
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'test-results/06-two-categories.png', fullPage: true });
  console.log('✓ Both indicators enabled (2 categories)');

  // Enable Utilities indicator (3 categories)
  console.log('Enabling Utilities indicator...');
  await page.click('.legend-category-row:has-text("Utilities") button:has-text("📊")');
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'test-results/07-three-categories.png', fullPage: true });
  console.log('✓ Three indicators enabled (3 categories)');

  // Switch to weekly view
  console.log('Switching to weekly view...');
  await page.click('button:has-text("Weekly Bars")');
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'test-results/08-weekly-grouped.png', fullPage: true });
  console.log('✓ Weekly view captured');

  // Switch back to monthly
  await page.click('button:has-text("Monthly Bars")');
  await page.waitForTimeout(1500);

  // Disable all indicators
  console.log('Disabling all indicators...');
  await page.click('.legend-category-row:has-text("Housing") button:has-text("📊")');
  await page.waitForTimeout(500);
  await page.click('.legend-category-row:has-text("Groceries") button:has-text("📊")');
  await page.waitForTimeout(500);
  await page.click('.legend-category-row:has-text("Utilities") button:has-text("📊")');
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'test-results/09-back-to-stacked.png', fullPage: true });
  console.log('✓ Back to stacked mode');

  console.log('\n✅ All screenshots captured successfully');
});
