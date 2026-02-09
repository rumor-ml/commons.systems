import { test } from '@playwright/test';

/**
 * Manual check with full console logging
 */

test('manual console check', async ({ page }) => {
  // Enable verbose console logging
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[BROWSER ${type.toUpperCase()}]`, text);
  });

  // Log page errors
  page.on('pageerror', (error) => {
    console.log('[PAGE ERROR]', error.message);
  });

  // Log requests
  page.on('request', (request) => {
    if (request.url().includes('localhost')) {
      console.log('[REQUEST]', request.method(), request.url());
    }
  });

  // Navigate with longer wait
  console.log('Navigating to http://localhost:5173/#/review');
  await page.goto('http://localhost:5173/#/review', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Wait and take screenshot
  console.log('Waiting 5 seconds...');
  await page.waitForTimeout(5000);

  console.log('Taking screenshot...');
  await page.screenshot({
    path: 'test-results/manual-check.png',
    fullPage: true,
  });

  console.log('Getting page content...');
  const pageContent = await page.content();
  console.log('Page has Firebase Setup guide:', pageContent.includes('Firebase Setup Required'));
  console.log('Page has transaction table:', pageContent.includes('<table'));
  console.log('Page has error message:', pageContent.includes('Failed to load'));

  // Keep page open for 10 seconds
  await page.waitForTimeout(10000);
});
