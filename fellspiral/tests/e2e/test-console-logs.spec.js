import { test } from '@playwright/test';

test('capture console logs during HTMX navigation on deployed site', async ({ page }) => {
  const deployedUrl =
    'https://fellspiral--220-fellspiral-card-library-improvements-7lj9anbp.web.app';

  // Collect console logs
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    console.log(`[CONSOLE ${msg.type().toUpperCase()}]:`, text);
  });

  // Collect errors
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error('[PAGE ERROR]:', error.message);
  });

  console.log('\n=== Step 1: Navigate to homepage ===');
  await page.goto(deployedUrl + '/');
  await page.waitForTimeout(2000);

  console.log('\n=== Step 2: Wait for library nav ===');
  await page.waitForSelector('.library-nav-type', { timeout: 10000 });
  console.log('Library nav loaded');

  console.log('\n=== Step 3: Click Equipment toggle ===');
  const equipmentToggle = page.locator(
    '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
  );
  await equipmentToggle.click();

  console.log('\n=== Step 4: Wait for URL change ===');
  try {
    await page.waitForURL(/cards.*#library\/equipment$/, { timeout: 10000 });
    console.log('URL changed to:', page.url());
  } catch (e) {
    console.error('URL did not change:', e.message);
    console.log('Current URL:', page.url());
  }

  console.log('\n=== Step 5: Wait for potential card loading ===');
  await page.waitForTimeout(15000);

  console.log('\n=== Step 6: Check final state ===');
  const state = await page.evaluate(() => {
    const loadingState = document.querySelector('.loading-state');
    const cardList = document.getElementById('cardList');
    const emptyState = document.getElementById('emptyState');
    const cardItems = document.querySelectorAll('.card-item');

    return {
      loadingVisible: loadingState
        ? window.getComputedStyle(loadingState).display !== 'none'
        : false,
      cardListDisplay: cardList ? window.getComputedStyle(cardList).display : null,
      emptyStateDisplay: emptyState ? window.getComputedStyle(emptyState).display : null,
      cardItemCount: cardItems.length,
    };
  });

  console.log('Loading visible:', state.loadingVisible);
  console.log('Card list display:', state.cardListDisplay);
  console.log('Empty state display:', state.emptyStateDisplay);
  console.log('Card items:', state.cardItemCount);

  console.log('\n=== All Console Logs ===');
  logs.forEach((log) => console.log(log));

  console.log('\n=== All Errors ===');
  if (errors.length === 0) {
    console.log('(no errors)');
  } else {
    errors.forEach((err) => console.log(err));
  }

  // Take screenshot
  await page.screenshot({ path: '/tmp/claude/htmx-nav-console.png', fullPage: true });
  console.log('\nScreenshot saved to /tmp/claude/htmx-nav-console.png');
});
