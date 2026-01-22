import { chromium } from '@playwright/test';

async function takeScreenshot() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to app...');
    await page.goto('http://localhost:5173/');
    await page.waitForSelector('.app-container', { timeout: 10000 });

    console.log('Navigating to planning page...');
    const planButton = page.locator('button:has-text("Plan Budget")');
    await planButton.click();
    await page.waitForURL(/\/#\/plan/, { timeout: 5000 });

    console.log('Setting budgets...');
    await page.locator('input[name="housing-budget"]').fill('500');
    await page.locator('input[name="dining-budget"]').fill('200');
    await page.locator('input[name="groceries-budget"]').fill('150');

    console.log('Saving budget...');
    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForURL(/\/#\//, { timeout: 5000 });
    await page.waitForTimeout(1000);

    console.log('Taking screenshot of monthly view...');
    await page.screenshot({ path: '/tmp/budget-monthly.png', fullPage: true });

    console.log('Switching to weekly bars...');
    const weeklyBarsRadio = page.locator('input[type="radio"][value="weekly"]');
    await weeklyBarsRadio.click();
    await page.waitForTimeout(1000);

    console.log('Taking screenshot of weekly view...');
    await page.screenshot({ path: '/tmp/budget-weekly-no-indicators.png', fullPage: true });

    console.log('Enabling Housing indicator...');
    const housingLegendItem = page.locator(
      '#legend-island .legend-category-row:has-text("Housing")'
    );
    const housingIndicatorToggle = housingLegendItem.locator('button:has-text("📊")');
    await housingIndicatorToggle.click();
    await page.waitForTimeout(500);

    console.log('Taking screenshot with Housing indicator...');
    await page.screenshot({ path: '/tmp/budget-weekly-housing-indicator.png', fullPage: true });

    console.log('Enabling Dining indicator...');
    const diningLegendItem = page.locator('#legend-island .legend-category-row:has-text("Dining")');
    const diningIndicatorToggle = diningLegendItem.locator('button:has-text("📊")');
    await diningIndicatorToggle.click();
    await page.waitForTimeout(500);

    console.log('Taking final screenshot with multiple indicators...');
    await page.screenshot({ path: '/tmp/budget-weekly-multiple-indicators.png', fullPage: true });

    // Check console logs
    const logs = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[BudgetChart]')) {
        logs.push(msg.text());
      }
    });

    // Get SVG content for analysis
    const svgContent = await page.locator('#chart-island svg').innerHTML();
    const pathCount = await page.locator('#chart-island svg path[stroke]').count();
    const barCount = await page.locator('#chart-island svg rect[fill]').count();

    console.log('\n=== Chart Analysis ===');
    console.log('Path count (lines):', pathCount);
    console.log('Bar count:', barCount);
    console.log('SVG length:', svgContent.length);

    if (logs.length > 0) {
      console.log('\n=== Console Logs ===');
      logs.forEach((log) => console.log(log));
    }

    console.log('\n=== Screenshots saved ===');
    console.log('1. /tmp/budget-monthly.png');
    console.log('2. /tmp/budget-weekly-no-indicators.png');
    console.log('3. /tmp/budget-weekly-housing-indicator.png');
    console.log('4. /tmp/budget-weekly-multiple-indicators.png');
  } catch (error) {
    console.error('Error:', error.message);
    await page.screenshot({ path: '/tmp/budget-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

takeScreenshot().catch(console.error);
