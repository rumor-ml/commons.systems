import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5001';

test.describe('Mythic Bastionland Realms', () => {
  test('loads the page successfully', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/Mythic Bastionland Realms/);
  });

  test('map renders without JavaScript errors', async ({ page }) => {
    // Collect all console errors
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Collect uncaught page errors
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(BASE_URL);

    // Wait for the map to actually render hexes (not just SVG element)
    // This catches initialization failures where React crashes before rendering
    await page.waitForSelector('svg polygon', { timeout: 10000 });

    // Count hexes - should have at least 50 for a valid map
    const hexCount = await page.locator('svg polygon').count();
    expect(hexCount).toBeGreaterThan(50);

    // Verify no error boundary is shown (React error fallback)
    const errorBoundary = page.locator('text=/error occurred|something went wrong/i');
    await expect(errorBoundary).toHaveCount(0);

    // Fail if there were any console errors related to the map component
    const mapErrors = consoleErrors.filter(
      (e) =>
        e.includes('MythicBastionland') ||
        e.includes('TypeError') ||
        e.includes('ReferenceError') ||
        e.includes('undefined')
    );
    expect(mapErrors).toEqual([]);

    // Fail if there were any uncaught page errors
    expect(pageErrors).toEqual([]);
  });

  test('map regeneration works without errors', async ({ page }) => {
    // Collect errors during regeneration
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(BASE_URL);
    await page.waitForSelector('svg polygon', { timeout: 10000 });

    // Click generate multiple times to test different seeds
    const generateButton = page.locator('button:has-text("Generate New Map")');

    for (let i = 0; i < 5; i++) {
      await generateButton.click();
      // Wait for new map to render
      await page.waitForTimeout(300);
      // Verify hexes still exist
      const hexCount = await page.locator('svg polygon').count();
      expect(hexCount).toBeGreaterThan(50);
    }

    // No errors should have occurred during any regeneration
    expect(pageErrors).toEqual([]);
  });

  test('displays main heading and description', async ({ page }) => {
    await page.goto(BASE_URL);

    const heading = page.locator('h1.site-title');
    await expect(heading).toContainText('Mythic Bastionland Realms');

    const lead = page.locator('.lead');
    await expect(lead).toBeVisible();
  });

  test('hex map component renders', async ({ page }) => {
    await page.goto(BASE_URL);

    // Wait for React island to hydrate
    const mapContainer = page.locator('#hex-map-root');
    await expect(mapContainer).toBeVisible();

    // Check for hex map controls
    const generateButton = page.locator('button:has-text("Generate New Map")');
    await expect(generateButton).toBeVisible();
  });

  test('generates new map on button click', async ({ page }) => {
    await page.goto(BASE_URL);

    // Wait for initial map to load
    await page.waitForSelector('svg', { timeout: 5000 });

    // Get initial SVG content
    const initialSvg = await page.locator('svg').innerHTML();

    // Click generate button
    const generateButton = page.locator('button:has-text("Generate New Map")');
    await generateButton.click();

    // Wait a bit for re-render
    await page.waitForTimeout(500);

    // Get new SVG content
    const newSvg = await page.locator('svg').innerHTML();

    // Content should have changed (different hexes)
    expect(newSvg).not.toBe(initialSvg);
  });

  test('displays hex details on click', async ({ page }) => {
    await page.goto(BASE_URL);

    // Wait for map to render
    await page.waitForSelector('svg polygon', { timeout: 5000 });

    // Click on a hex
    const firstHex = page.locator('svg polygon').first();
    await firstHex.click();

    // Check for hex details
    const details = page.locator('.hex-details');
    await expect(details).toBeVisible();
    await expect(details).toContainText('Hex Details');
    await expect(details).toContainText('Terrain:');
  });

  test('map size slider works', async ({ page }) => {
    await page.goto(BASE_URL);

    // Wait for map to render
    await page.waitForSelector('svg polygon', { timeout: 5000 });

    // Count initial hexes
    const initialHexCount = await page.locator('svg polygon').count();

    // Change map size
    const slider = page.locator('input[type="range"]#radius');
    await slider.fill('6');

    // Wait for re-render
    await page.waitForTimeout(500);

    // Count new hexes (should be more)
    const newHexCount = await page.locator('svg polygon').count();
    expect(newHexCount).toBeGreaterThan(initialHexCount);
  });

  test('legend displays all terrain types', async ({ page }) => {
    await page.goto(BASE_URL);

    const legend = page.locator('.legend');
    await expect(legend).toBeVisible();

    // Check for some terrain types
    await expect(legend).toContainText('Plains');
    await expect(legend).toContainText('Forest');
    await expect(legend).toContainText('Mountains');

    // Check for markers
    await expect(legend).toContainText('Point of Interest');
    await expect(legend).toContainText('Encounter');
  });

  test('export button exists', async ({ page }) => {
    await page.goto(BASE_URL);

    const exportButton = page.locator('button:has-text("Export Map")');
    await expect(exportButton).toBeVisible();
  });

  test('hexes have visual indicators for POI and encounters', async ({ page }) => {
    await page.goto(BASE_URL);

    // Wait for map to render
    await page.waitForSelector('svg', { timeout: 5000 });

    // Check if there are any circles (markers)
    const circles = page.locator('svg circle');
    const circleCount = await circles.count();

    // Should have at least some markers on a typical map
    expect(circleCount).toBeGreaterThan(0);
  });

  test('responsive design works on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE_URL);

    // Check that main elements are still visible
    const heading = page.locator('h1.site-title');
    await expect(heading).toBeVisible();

    const mapContainer = page.locator('#hex-map-root');
    await expect(mapContainer).toBeVisible();
  });

  test('info section explains the generator', async ({ page }) => {
    await page.goto(BASE_URL);

    const infoSection = page.locator('.info-section');
    await expect(infoSection).toBeVisible();
    await expect(infoSection).toContainText('About the Generator');
    await expect(infoSection).toContainText('Controls');
    await expect(infoSection).toContainText('Mythic Bastionland');
  });
});
