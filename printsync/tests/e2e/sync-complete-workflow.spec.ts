import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('Complete Sync Workflow', () => {
  let testDir: string;

  test.beforeEach(async () => {
    // Create temporary directory with real test files
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printsync-e2e-'));

    // Create actual PDF files (minimal valid PDFs)
    const pdfContent =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';
    fs.writeFileSync(path.join(testDir, 'book1.pdf'), pdfContent);
    fs.writeFileSync(path.join(testDir, 'book2.pdf'), pdfContent);
  });

  test.afterEach(async () => {
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should complete full sync workflow', async ({ page }) => {
    await page.goto('/');

    // Fill in form
    await page.fill('input[name="directory"]', testDir);

    // Select file types
    await page.check('input[value=".pdf"]');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for sync monitor to appear
    await expect(page.locator('h2:has-text("Sync in Progress")')).toBeVisible({ timeout: 10000 });

    // Wait for files to be discovered (stats should update)
    await expect(
      page.locator('text=/Discovered/').locator('xpath=preceding-sibling::div')
    ).not.toHaveText('0', { timeout: 10000 });

    // Verify discovered count is 2
    const discoveredCount = await page
      .locator('text=/Discovered/')
      .locator('xpath=preceding-sibling::div')
      .textContent();
    expect(parseInt(discoveredCount || '0')).toBe(2);

    // Wait for extraction to complete
    await expect(
      page.locator('text=/Extracted/').locator('xpath=preceding-sibling::div')
    ).not.toHaveText('0', { timeout: 10000 });

    // Verify extracted count matches discovered
    const extractedCount = await page
      .locator('text=/Extracted/')
      .locator('xpath=preceding-sibling::div')
      .textContent();
    expect(parseInt(extractedCount || '0')).toBe(2);

    // Verify no errors
    const errorCount = await page
      .locator('text=/Errors/')
      .locator('xpath=preceding-sibling::div')
      .textContent();
    expect(parseInt(errorCount || '0')).toBe(0);

    // Verify files appear in list
    await expect(page.locator('#file-list .file-row')).toHaveCount(2, { timeout: 5000 });

    // Verify upload button appears
    await expect(page.locator('#upload-selected-btn')).toBeVisible();
  });

  test('should NOT show duplicate stats', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[name="directory"]', testDir);
    await page.click('button[type="submit"]');

    // Wait for sync monitor
    await expect(page.locator('h2:has-text("Sync in Progress")')).toBeVisible();

    // Count how many "Discovered" labels exist
    const discoveredLabels = await page.locator('text=/^Discovered$/').count();
    expect(discoveredLabels).toBe(1); // Should only appear once!

    const extractedLabels = await page.locator('text=/^Extracted$/').count();
    expect(extractedLabels).toBe(1);

    const uploadedLabels = await page.locator('text=/^Uploaded$/').count();
    expect(uploadedLabels).toBe(1);

    const errorLabels = await page.locator('text=/^Errors$/').count();
    expect(errorLabels).toBe(1);
  });

  test('should receive SSE events', async ({ page }) => {
    const sseEvents: string[] = [];

    // Intercept SSE requests
    page.on('response', async (response) => {
      if (response.url().includes('/stream')) {
        const contentType = response.headers()['content-type'];
        if (contentType?.includes('text/event-stream')) {
          sseEvents.push('SSE connection established');
        }
      }
    });

    await page.goto('/');
    await page.fill('input[name="directory"]', testDir);
    await page.check('input[value=".pdf"]');
    await page.click('button[type="submit"]');

    // Wait for sync monitor
    await expect(page.locator('h2:has-text("Sync in Progress")')).toBeVisible();

    // Verify SSE connection was established
    await page.waitForTimeout(2000); // Give time for SSE to connect
    expect(sseEvents.length).toBeGreaterThan(0);
  });

  test('should progress past Initializing', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[name="directory"]', testDir);
    await page.click('button[type="submit"]');

    // Wait for sync monitor
    await expect(page.locator('h2:has-text("Sync in Progress")')).toBeVisible();

    // Wait for phase indicator to appear
    await page.waitForSelector('#phase-indicator', { timeout: 10000 });

    // If still initializing, wait for it to progress
    // Note: Sync may be fast enough that we never see "Initializing"
    const progressText = await page.locator('#phase-indicator').textContent();
    if (progressText?.includes('Initializing')) {
      // Should progress beyond "Initializing..." within 10 seconds
      await expect(page.locator('text=/Initializing/')).not.toBeVisible({ timeout: 10000 });
    }

    // Should show some progress indication
    const finalProgress = await page.locator('#phase-indicator').textContent();
    expect(finalProgress).toBeTruthy();
  });
});
