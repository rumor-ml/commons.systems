import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * File List Deduplication E2E Tests
 *
 * These tests trigger the complete sync pipeline (discovery → extraction → SSE → UI)
 * to verify the file list deduplication fix works correctly in realistic scenarios.
 *
 * Pattern: Follows sync-complete-workflow.spec.ts approach with real files and form submission
 */
test.describe('File List Deduplication - Real Sync Pipeline', () => {
  let testDir: string;

  test.beforeEach(async () => {
    // Create temporary directory for test files
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printsync-dedup-test-'));

    // Create minimal valid PDF content (smallest valid PDF structure)
    const pdfContent =
      '%PDF-1.4\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
      'xref\n' +
      '0 4\n' +
      '0000000000 65535 f\n' +
      '0000000009 00000 n\n' +
      '0000000056 00000 n\n' +
      '0000000115 00000 n\n' +
      'trailer<</Size 4/Root 1 0 R>>\n' +
      'startxref\n' +
      '190\n' +
      '%%EOF';

    // Create 3 test PDFs
    fs.writeFileSync(path.join(testDir, 'book1.pdf'), pdfContent);
    fs.writeFileSync(path.join(testDir, 'book2.pdf'), pdfContent);
    fs.writeFileSync(path.join(testDir, 'book3.pdf'), pdfContent);
  });

  test.afterEach(async () => {
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should NOT show duplicate file rows during initial SSE load', async ({ page }) => {
    // 1. Navigate to homepage
    await page.goto('/');

    // 2. Submit sync form with real directory path (triggers full pipeline)
    await page.fill('input[name="directory"]', testDir);
    await page.click('button[type="submit"]');

    // 3. Wait for sync monitor to appear (SSE connection established)
    await expect(page.locator('h2:has-text("Sync in Progress")')).toBeVisible({ timeout: 10000 });

    // 4. Wait for discovery phase to complete
    await expect(
      page.locator('text=/Discovered/').locator('xpath=preceding-sibling::div')
    ).not.toHaveText('0', {
      timeout: 10000,
    });

    // 5. Wait for extraction to complete
    await expect(
      page.locator('text=/Extracted/').locator('xpath=preceding-sibling::div')
    ).not.toHaveText('0', {
      timeout: 10000,
    });

    // 6. CRITICAL TEST: Verify exactly 3 files appear in list (no duplicates from initial SSE load)
    await expect(page.locator('#file-list .file-row')).toHaveCount(3, { timeout: 5000 });

    // 7. Verify no duplicate stat labels (additional deduplication check)
    const discoveredLabels = await page.locator('text=/^Discovered$/').count();
    expect(discoveredLabels).toBe(1, 'Discovered stat should appear only once');

    const extractedLabels = await page.locator('text=/^Extracted$/').count();
    expect(extractedLabels).toBe(1, 'Extracted stat should appear only once');

    const uploadedLabels = await page.locator('text=/^Uploaded$/').count();
    expect(uploadedLabels).toBe(1, 'Uploaded stat should appear only once');
  });

  test('should NOT duplicate file rows when status updates via OOB swap', async ({ page }) => {
    // 1. Start sync workflow
    await page.goto('/');
    await page.fill('input[name="directory"]', testDir);
    await page.click('button[type="submit"]');

    // 2. Wait for files to appear in list
    await expect(page.locator('#file-list .file-row')).toHaveCount(3, { timeout: 15000 });

    // 3. Get first file row
    const firstFileRow = page.locator('#file-list .file-row').first();
    const fileId = await firstFileRow.getAttribute('id');

    // 4. Verify file has exactly one approve button before action
    const approveButtonsBefore = firstFileRow.locator('button:has-text("Approve")');
    await expect(approveButtonsBefore).toHaveCount(1);

    // 5. Click approve button (triggers SSE update with hx-swap-oob="true")
    const approveButton = firstFileRow.locator('button:has-text("Approve")');
    if (await approveButton.isVisible()) {
      await approveButton.click();

      // Wait for file status to change via SSE - check for status update in UI
      await page
        .waitForFunction(
          (fid) => {
            const row = document.querySelector(`#${fid}`);
            if (!row) return false;
            // Check if status changed (button state changed or trash button appeared)
            const hasTrashButton = row.querySelector('button[aria-label*="trash"]') !== null;
            const hasApproveButton = row.querySelector('button:has-text("Approve")') !== null;
            return hasTrashButton || !hasApproveButton;
          },
          fileId,
          { timeout: 10000 }
        )
        .catch(() => {});

      // 6. CRITICAL TEST: Verify STILL only 3 total files (no duplication after OOB swap)
      await expect(page.locator('#file-list .file-row')).toHaveCount(3);

      // 7. Verify specific file appears exactly once
      const fileRowCount = await page.locator(`#${fileId}`).count();
      expect(fileRowCount).toBe(1, 'File row should update in-place via OOB swap, not duplicate');

      // 8. Verify updated row has expected action buttons (trash button after upload)
      const updatedRow = page.locator(`#${fileId}`);
      const trashButtons = updatedRow.locator('button[aria-label*="trash"]');

      // Should have trash button OR approve button, but not duplicates of either
      const approveButtonsAfter = updatedRow.locator('button:has-text("Approve")');
      const totalButtons = (await approveButtonsAfter.count()) + (await trashButtons.count());
      expect(totalButtons).toBeLessThanOrEqual(
        2,
        'Should not have duplicate action buttons after OOB swap'
      );
    }
  });

  test('should handle rapid status changes without creating duplicates', async ({ page }) => {
    // This test verifies the OOB swap correctly handles multiple rapid updates

    // 1. Start sync
    await page.goto('/');
    await page.fill('input[name="directory"]', testDir);
    await page.click('button[type="submit"]');

    // 2. Wait for files to be discovered and extracted
    await expect(page.locator('#file-list .file-row')).toHaveCount(3, { timeout: 15000 });

    // 3. Monitor file list size as pipeline progresses (discovery → extraction → upload)
    // The file count should remain stable at 3 throughout all status changes

    // Wait for extraction to complete
    await expect(
      page.locator('text=/Extracted/').locator('xpath=preceding-sibling::div')
    ).not.toHaveText('0', {
      timeout: 10000,
    });

    // 4. Verify count still 3 (no duplicates during extraction phase)
    let fileRowCount = await page.locator('#file-list .file-row').count();
    expect(fileRowCount).toBe(3, 'File count should remain 3 during extraction');

    // 5. Approve first file (triggers upload)
    const firstFile = page.locator('#file-list .file-row').first();
    const approveButton = firstFile.locator('button:has-text("Approve")');
    if (await approveButton.isVisible()) {
      await approveButton.click();

      // Wait for file count to stabilize after upload (no duplicates should be added)
      await page
        .waitForFunction(
          () => {
            const rows = document.querySelectorAll('#file-list .file-row');
            return rows.length === 3;
          },
          { timeout: 5000 }
        )
        .catch(() => {});

      // 6. Verify count STILL 3 (no duplicates during upload)
      fileRowCount = await page.locator('#file-list .file-row').count();
      expect(fileRowCount).toBe(3, 'File count should remain 3 after approval/upload');
    }
  });
});
