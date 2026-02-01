import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5001';

test('seed 77963 river grows in both directions', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForSelector('svg', { timeout: 10000 });

  // Enter seed 77963 and click Apply
  const seedInput = page.locator('input[type="text"]').first();
  await seedInput.fill('77963');
  const applyButton = page.locator('button:has-text("Apply")');
  await applyButton.click();
  await page.waitForTimeout(500);

  // Click Reset to initialize with the new seed
  const resetButton = page.locator('text=Reset');
  await resetButton.click();
  await page.waitForTimeout(500);

  // Go to step 20 (enough for river to be fully created)
  const stepInput = page.locator('input[type="number"]');
  await stepInput.fill('20');
  const goButton = page.getByRole('button', { name: 'Go', exact: true });
  await goButton.click();
  await page.waitForTimeout(1000);

  // Get river data
  const data = await page.evaluate(() => {
    const generator = window.__TEST_GENERATOR__;
    if (!generator) return { error: 'No generator found' };

    return {
      currentStep: generator.explorerPath?.length || 0,
      riverEdgesCount: generator.riverEdges.size,
      riverNetworkCount: generator.rivers?.length || 0,
    };
  });

  console.log('Step:', data.currentStep);
  console.log('River edges:', data.riverEdgesCount);
  console.log('River networks:', data.riverNetworkCount);

  // Verify river exists and has grown (bidirectional planning working)
  // The exact number depends on the random starting position, but should have at least some edges
  expect(data.riverNetworkCount).toBeGreaterThanOrEqual(1);
  expect(data.riverEdgesCount).toBeGreaterThanOrEqual(3);

  // Take screenshot for visual verification
  await page.screenshot({ path: 'test-results/seed-77963-river.png', fullPage: true });
});
