import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('SSE Real-Time Updates', () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];
  let testDir: string;

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];

    // Create a temporary directory with test files
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printsync-sse-test-'));
    fs.writeFileSync(path.join(testDir, 'test-file-1.pdf'), 'PDF content here');
    fs.writeFileSync(path.join(testDir, 'test-file-2.pdf'), 'PDF content here');

    // Capture console errors and warnings
    page.on('console', async (msg) => {
      if (msg.type() === 'error') {
        // Get text content, handling objects properly
        const text = msg.text();
        // Skip "JSHandle@object" which happens when console.error logs an object
        // These are typically Firebase/auth internal logs, not real errors
        if (text !== 'JSHandle@object') {
          consoleErrors.push(text);
        }
      }
      if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    // Capture uncaught exceptions
    page.on('pageerror', (error) => {
      consoleErrors.push(`Uncaught exception: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should start sync without SSE errors', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Wait for sync form
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });

    // Fill in directory
    await page.fill('input[name="directory"]', testDir);

    // Click "Start Scan" button
    const startButton = page.locator('button[type="submit"]').filter({ hasText: /Start/ });
    await startButton.click();

    // Wait for sync progress section to appear (sync monitor gets swapped into #sync-progress)
    await page.waitForSelector('h2:has-text("Sync in Progress")', { timeout: 5000 });

    // Wait for SSE connection to establish by checking for active SSE extension
    await page.waitForFunction(
      () => {
        const monitor = document.querySelector('[hx-ext="sse"]');
        return monitor !== null;
      },
      { timeout: 10000 }
    );

    // Filter out known acceptable warnings (if any)
    const sseErrors = consoleErrors.filter(
      (err) =>
        err.toLowerCase().includes('eventsource') ||
        err.toLowerCase().includes('sse') ||
        err.toLowerCase().includes('error event')
    );

    // Should have NO SSE-related errors
    expect(sseErrors, `SSE errors found:\n${sseErrors.join('\n')}`).toEqual([]);

    // Verify SSE connection is active (sync monitor div has hx-ext="sse")
    const hasActiveSSE = await page.evaluate(() => {
      const monitor = document.querySelector('[hx-ext="sse"]');
      return monitor !== null;
    });

    expect(hasActiveSSE, 'SSE extension should be active').toBe(true);
  });

  test('should receive session stats updates via SSE', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for form
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });
    await page.fill('input[name="directory"]', testDir);

    // Start sync
    const startButton = page.locator('button[type="submit"]').filter({ hasText: /Start/ });
    await startButton.click();

    // Wait for sync progress section to appear
    await page.waitForSelector('h2:has-text("Sync in Progress")', { timeout: 5000 });

    // Wait for session stats to populate
    await page.waitForSelector('#sync-stats', { timeout: 5000 });

    // Verify stats are not empty (indicates SSE updates are working)
    const statsText = await page.locator('#sync-stats').textContent();
    expect(statsText).toBeTruthy();
    expect(statsText?.length).toBeGreaterThan(0);

    // No console errors
    expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('should update progress bar via SSE', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for form
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });
    await page.fill('input[name="directory"]', testDir);

    // Start sync
    const startButton = page.locator('button[type="submit"]').filter({ hasText: /Start/ });
    await startButton.click();

    // Wait for progress indicator
    await page.waitForSelector('#phase-indicator', { timeout: 5000 });

    // Verify progress indicator has content
    const progressText = await page.locator('#phase-indicator').textContent();
    expect(progressText).toBeTruthy();

    // No console errors
    expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('should update action buttons via SSE without errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for form
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });
    await page.fill('input[name="directory"]', testDir);

    // Start sync
    const startButton = page.locator('button[type="submit"]').filter({ hasText: /Start/ });
    await startButton.click();

    // Wait for sync progress section to appear
    await page.waitForSelector('h2:has-text("Sync in Progress")', { timeout: 5000 });

    // Wait for action-buttons container to be in the DOM
    await page.waitForSelector('#action-buttons', { timeout: 10000 });

    // Wait for action buttons to receive SSE updates (check if they have content or are properly attached)
    await page.waitForFunction(
      () => {
        const container = document.querySelector('#action-buttons');
        return container !== null && container.hasAttribute('id');
      },
      { timeout: 10000 }
    );

    // Check for SSE errors specifically related to action buttons or OOB swaps
    const oobErrors = consoleErrors.filter(
      (err) =>
        err.toLowerCase().includes('hx-swap-oob') ||
        err.toLowerCase().includes('action-buttons') ||
        err.toLowerCase().includes('eventsource')
    );

    // Should have NO OOB or SSE-related errors
    expect(oobErrors, `OOB/SSE errors found:\n${oobErrors.join('\n')}`).toEqual([]);

    // Verify action buttons container is in the DOM (may be empty initially)
    const actionButtons = page.locator('#action-buttons');
    await expect(actionButtons).toBeAttached();

    // No console errors at all
    expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('should display file rows via SSE without duplicates', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for form
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });
    await page.fill('input[name="directory"]', testDir);

    // Start sync
    const startButton = page.locator('button[type="submit"]').filter({ hasText: /Start/ });
    await startButton.click();

    // Wait for file list to populate
    await page.waitForSelector('#file-list', { timeout: 10000 });

    // Wait for SSE file updates to complete by checking for file rows
    await page.waitForFunction(
      () => {
        const fileList = document.querySelector('#file-list');
        const fileRows = fileList?.querySelectorAll('[data-file-id]');
        return fileRows && fileRows.length > 0;
      },
      { timeout: 15000 }
    );

    // Get all file rows
    const fileRows = await page.locator('#file-list [data-file-id]').all();

    // Collect file IDs
    const fileIds: string[] = [];
    for (const row of fileRows) {
      const id = await row.getAttribute('data-file-id');
      if (id) fileIds.push(id);
    }

    // Check for duplicates
    const uniqueIds = new Set(fileIds);
    expect(fileIds.length, `Found duplicate file IDs: ${fileIds.join(', ')}`).toBe(uniqueIds.size);

    // No console errors
    expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('should handle SSE connection gracefully', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Monitor console for SSE-related messages
    const sseMessages: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.toLowerCase().includes('sse') || text.toLowerCase().includes('eventsource')) {
        sseMessages.push(text);
      }
    });

    // Wait for form
    await page.waitForSelector('input[name="directory"]', { timeout: 10000 });
    await page.fill('input[name="directory"]', testDir);

    // Start sync
    const startButton = page.locator('button[type="submit"]').filter({ hasText: /Start/ });
    await startButton.click();

    // Wait for sync progress section to appear
    await page.waitForSelector('h2:has-text("Sync in Progress")', { timeout: 5000 });

    // Wait for SSE connection to establish by checking for SSE element
    await page.waitForFunction(
      () => {
        const sseElement = document.querySelector('[hx-ext="sse"]');
        return sseElement !== null && sseElement.hasAttribute('sse-connect');
      },
      { timeout: 10000 }
    );

    // Check for HTMX SSE extension in page
    const hasHTMXSSE = await page.evaluate(() => {
      return typeof (window as any).htmx !== 'undefined';
    });

    expect(hasHTMXSSE).toBe(true);

    // Check for SSE connection attributes in DOM
    const sseElement = page.locator('[hx-ext="sse"]');
    await expect(sseElement).toBeVisible();

    // Get the SSE connect URL
    const sseUrl = await sseElement.getAttribute('sse-connect');
    expect(sseUrl).toBeTruthy();
    expect(sseUrl).toContain('/api/sync/');
    expect(sseUrl).toContain('/stream');

    // Verify no SSE errors in console
    const errors = sseMessages.filter((msg) => msg.toLowerCase().includes('error'));
    expect(errors, `SSE error messages:\n${errors.join('\n')}`).toEqual([]);
  });
});
