import { test, expect } from '../fixtures/printsync-fixtures';

test.describe('Homepage', () => {
  test('loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Printsync/);
  });

  test('displays sync page correctly', async ({ page }) => {
    await page.goto('/');

    // Verify main heading
    await expect(page.locator('h1')).toContainText('Sync Files');

    // Verify sections exist
    await expect(page.locator('h2').filter({ hasText: 'Start New Sync' })).toBeVisible();
    await expect(page.locator('h2').filter({ hasText: 'Recent Syncs' })).toBeVisible();
  });

  test('HTMX partial loading works', async ({ page }) => {
    await page.goto('/');

    // Wait for sync form to load
    await page.waitForSelector('input[name="directory"]', { timeout: 5000 });

    // Wait for history section to load
    await page.waitForSelector('#sync-history', { timeout: 5000 });
  });

  test('file-selection.js loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that our JavaScript functions are defined
    const functionsExist = await page.evaluate(() => {
      return {
        toggleAllExtracted: typeof (window as any).toggleAllExtracted === 'function',
        updateSelectAllState: typeof (window as any).updateSelectAllState === 'function',
        updateButtonState: typeof (window as any).updateButtonState === 'function',
      };
    });

    expect(functionsExist.toggleAllExtracted).toBe(true);
    expect(functionsExist.updateSelectAllState).toBe(true);
    expect(functionsExist.updateButtonState).toBe(true);
  });

  test('health endpoint returns OK', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('healthy');
  });
});
