import { firefox } from 'playwright';

async function main() {
  const browser = await firefox.launch();
  const page = await browser.newPage();

  const deployedUrl =
    'https://fellspiral--220-fellspiral-card-library-improvements-7lj9anbp.web.app';

  // Collect errors
  page.on('pageerror', (error) => {
    console.error('[PAGE ERROR]:', error.message);
  });

  console.log('=== Starting debug test ===');
  await page.goto(deployedUrl + '/');
  await page.waitForTimeout(2000);

  // Wait for library nav
  await page.waitForSelector('.library-nav-type', { timeout: 10000 });
  console.log('Library nav loaded');

  // Get the href of the Equipment toggle
  const equipmentHref = await page
    .locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle')
    .getAttribute('href');
  console.log('Equipment href:', equipmentHref);

  // Click Equipment
  await page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle').click();
  await page.waitForTimeout(3000);

  console.log('Current URL after click:', page.url());

  // Check loading state
  const loadingVisible = await page
    .locator('.loading-state')
    .isVisible()
    .catch(() => false);
  const cardCount = await page.locator('.card-item').count();

  console.log('Loading visible:', loadingVisible);
  console.log('Card count:', cardCount);

  await browser.close();
}

main().catch(console.error);
