import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:3004';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  console.log('Loading page...');
  await page.goto(BASE_URL);
  await page.waitForSelector('svg', { timeout: 10000 });

  // Enter seed 12345 and click Apply
  console.log('Setting seed 12345...');
  const seedInput = page.locator('input[type="text"]').first();
  await seedInput.fill('12345');

  // Click Apply button
  const applyButton = page.locator('button:has-text("Apply")');
  await applyButton.click();
  await page.waitForTimeout(1000);

  // Click Forward button twice to get to step 2
  console.log('Stepping forward to step 1...');
  const forwardButton = page.locator('button:has-text("Forward")');
  await forwardButton.click();
  await page.waitForTimeout(1000);

  console.log('Stepping forward to step 2...');
  await forwardButton.click();
  await page.waitForTimeout(1000);

  // Take screenshot
  console.log('Taking screenshot...');
  await page.screenshot({ path: '/tmp/claude/seed-12345-step2.png', fullPage: true });
  console.log('Screenshot saved to /tmp/claude/seed-12345-step2.png');

  await browser.close();
}

main().catch(console.error);
