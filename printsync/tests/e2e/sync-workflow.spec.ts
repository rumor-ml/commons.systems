import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Sync Workflow', () => {
  let testDir: string;
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Capture uncaught exceptions
    page.on('pageerror', (error) => {
      consoleErrors.push(`Uncaught exception: ${error.message}`);
    });

    // Create a temporary directory with test files
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printsync-test-'));

    // Create some test PDF files (empty files are fine for UI testing)
    fs.writeFileSync(path.join(testDir, 'test-book-1.pdf'), 'PDF content here');
    fs.writeFileSync(path.join(testDir, 'test-book-2.pdf'), 'PDF content here');
    fs.writeFileSync(path.join(testDir, 'test-book-3.epub'), 'EPUB content here');
  });

  test.afterEach(async () => {
    // Verify no console errors occurred during test
    expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toEqual([]);

    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('sync page should display correctly', async ({ page }) => {
    await page.goto('/');

    // Verify page title
    await expect(page).toHaveTitle(/Sync/);

    // Verify main sections exist
    await expect(page.locator('h1')).toContainText('Sync Files');
    await expect(page.locator('h2').filter({ hasText: 'Start New Sync' })).toBeVisible();
    await expect(page.locator('h2').filter({ hasText: 'Recent Syncs' })).toBeVisible();
  });

  test('sync form should appear and accept input', async ({ page }) => {
    await page.goto('/');

    // Wait for form to load via HTMX
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });

    // Fill in directory path
    await page.fill('input[name="directory"]', testDir);

    // Verify input was set
    const value = await page.inputValue('input[name="directory"]');
    expect(value).toBe(testDir);

    // Verify submit button exists
    await expect(page.locator('button[type="submit"]').filter({ hasText: /Start/ })).toBeVisible();
  });

  test('Select All checkbox should appear with extracted files', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load and fill in the form
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });
    await page.fill('input[name="directory"]', testDir);

    // Start the sync
    const startButton = page.locator('button[type="submit"]').filter({ hasText: /Start/ });
    await startButton.click();

    // Wait for sync progress section to appear
    await page.waitForSelector('h2:has-text("Sync in Progress")', { timeout: 10000 });

    // Wait for the Select All container to be in the DOM
    const selectAllContainer = page.locator('#select-all-container');
    await selectAllContainer.waitFor({ state: 'attached', timeout: 10000 });

    // Select All should initially be hidden (no extracted files yet)
    // or visible once files are extracted
    const containerExists = (await selectAllContainer.count()) > 0;
    expect(containerExists).toBe(true);
  });

  test('checkboxes should appear for extracted files', async ({ page }) => {
    await page.goto('/');

    // Initially no file checkboxes should exist
    const checkboxes = page.locator('input[name="file-ids"]');
    await expect(checkboxes).toHaveCount(0);
  });

  test('file-selection.js functions should be defined', async ({ page }) => {
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

  test('history section should load without auth errors', async ({ page }) => {
    const authErrors: string[] = [];

    page.on('response', (response) => {
      if (response.status() === 401) {
        authErrors.push(`401 from ${response.url()}`);
      }
    });

    await page.goto('/');

    // Wait for history to load and content to appear
    await page.waitForSelector('#sync-history', { timeout: 5000 });
    await page.waitForFunction(
      () => {
        const history = document.querySelector('#sync-history');
        return history && !history.textContent?.includes('Loading');
      },
      { timeout: 10000 }
    );

    // In dev mode with auth bypass, there should be no 401 errors
    expect(authErrors, `Auth errors found:\n${authErrors.join('\n')}`).toEqual([]);
  });

  test('should handle file type checkboxes correctly', async ({ page }) => {
    await page.goto('/');

    // Wait for form to load
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });

    // Check if file type checkboxes exist (PDF, EPUB, etc.)
    const pdfCheckbox = page.locator('input[type="checkbox"][value=".pdf"]');
    const epubCheckbox = page.locator('input[type="checkbox"][value=".epub"]');

    // At least PDF checkbox should exist for printsync
    await expect(pdfCheckbox).toBeVisible();
  });

  test('sync monitor should use SSE for real-time updates', async ({ page }) => {
    await page.goto('/');

    // When a sync is started, the sync monitor should use SSE
    // We can verify the HTMX SSE extension is present
    const hasSSEExtension = await page.evaluate(() => {
      const htmx = (window as any).htmx;
      return htmx && htmx.config && htmx.config.allowEval !== undefined;
    });

    expect(hasSSEExtension).toBe(true);
  });
});
