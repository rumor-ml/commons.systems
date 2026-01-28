import { test, expect } from '@playwright/test';

/**
 * QA Environment E2E Tests
 *
 * These tests verify that the QA environment (make dev-qa) correctly connects
 * to Firebase emulators without requiring production Firebase configuration.
 *
 * @tag qa
 */
test.describe('QA Environment', () => {
  test.beforeEach(async ({ page }) => {
    // Listen for console messages to capture emulator connection logs
    page.on('console', (msg) => {
      if (msg.type() === 'log') {
        console.log('Browser console:', msg.text());
      }
    });
  });

  test('should connect to Firebase emulators without config errors', async ({ page }) => {
    const consoleMessages: string[] = [];
    const errorMessages: string[] = [];

    // Capture console logs
    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
      if (msg.type() === 'error') {
        errorMessages.push(msg.text());
      }
    });

    // Navigate to the app
    await page.goto('/');
    await page.waitForSelector('.app-container', { timeout: 10000 });

    // Verify no Firebase configuration errors
    const configErrors = errorMessages.filter(
      (msg) =>
        msg.includes('Missing required Firebase environment variables') ||
        (msg.includes('Firebase') && msg.includes('error'))
    );
    expect(configErrors).toHaveLength(0);

    // Verify emulator connection logs appear
    const hasFirestoreEmulatorLog = consoleMessages.some((msg) =>
      msg.includes('Connected to Firestore emulator')
    );
    const hasAuthEmulatorLog = consoleMessages.some((msg) =>
      msg.includes('Connected to Auth emulator')
    );

    // At least one emulator should be connected
    // (Auth may not connect until user interaction)
    expect(hasFirestoreEmulatorLog || hasAuthEmulatorLog).toBe(true);
  });

  test('should load demo transactions from emulator', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container', { timeout: 10000 });

    // Wait for chart to render (indicates transactions loaded)
    const chartSvg = page.locator('#chart-island svg');
    await expect(chartSvg).toBeVisible({ timeout: 15000 });

    // Verify chart has bars (demo data loaded)
    const bars = page.locator('#chart-island svg rect[class*="bar"]');
    const barCount = await bars.count();
    expect(barCount).toBeGreaterThan(0);

    // Verify legend shows categories (demo data loaded)
    const legendItems = page.locator('#legend-island .legend-category-row');
    const legendCount = await legendItems.count();
    expect(legendCount).toBeGreaterThan(0);
  });

  test('should handle emulator connection gracefully on hot reload', async ({ page }) => {
    const consoleMessages: string[] = [];

    // Capture console logs
    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });

    await page.goto('/');
    await page.waitForSelector('.app-container', { timeout: 10000 });

    // Trigger a hot reload by navigating away and back
    await page.goto('/about:blank');
    await page.waitForTimeout(500);
    await page.goto('/');
    await page.waitForSelector('.app-container', { timeout: 10000 });

    // Should not have errors about emulator already initialized
    const hasAlreadyInitializedError = consoleMessages.some(
      (msg) =>
        msg.includes('error') &&
        (msg.includes('already been started') || msg.includes('already been used'))
    );
    expect(hasAlreadyInitializedError).toBe(false);

    // Should have confirmation messages instead
    const hasAlreadyEstablishedLog = consoleMessages.some(
      (msg) =>
        msg.includes('emulator connection already established') ||
        (msg.includes('Connected to') && msg.includes('emulator'))
    );
    expect(hasAlreadyEstablishedLog).toBe(true);
  });

  test('should render app without Firebase errors in console', async ({ page }) => {
    const errorMessages: string[] = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errorMessages.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForSelector('.app-container', { timeout: 10000 });

    // Wait for chart to render
    await expect(page.locator('#chart-island svg')).toBeVisible({ timeout: 15000 });

    // Filter out expected/benign errors (if any)
    const firebaseErrors = errorMessages.filter(
      (msg) =>
        msg.includes('Firebase') ||
        msg.includes('Firestore') ||
        msg.includes('Auth') ||
        msg.includes('Missing required')
    );

    expect(firebaseErrors).toHaveLength(0);
  });

  test('should display QA environment with emulator data', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container', { timeout: 10000 });

    // Verify core UI elements are present
    await expect(page.locator('#chart-island')).toBeVisible();
    await expect(page.locator('#legend-island')).toBeVisible();

    // Verify chart has data (from emulator seeding)
    const chartSvg = page.locator('#chart-island svg');
    await expect(chartSvg).toBeVisible({ timeout: 15000 });

    // Verify date range controls are present
    const startDateInput = page.locator('input[type="date"]').first();
    const endDateInput = page.locator('input[type="date"]').last();
    await expect(startDateInput).toBeVisible();
    await expect(endDateInput).toBeVisible();

    // Verify navigation buttons are present
    const planButton = page.locator('button:has-text("Set Budget Targets")');
    await expect(planButton).toBeVisible();
  });
});
