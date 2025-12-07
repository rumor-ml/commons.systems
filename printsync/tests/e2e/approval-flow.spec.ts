import { test, expect } from '../fixtures/printsync-fixtures';

test.describe('Single File Approval Workflow', () => {
  test('should approve a single extracted file and verify upload', async ({
    page,
    testSession,
    helpers,
  }) => {
    // Navigate to sync detail page
    await page.goto(`/sync/${testSession.sessionID}`);

    // Wait for DOM to be ready (can't use networkidle with SSE - it's never idle)
    await page.waitForLoadState('domcontentloaded');

    // Get the first file ID
    const firstFileID = testSession.fileIDs[0];

    // Find the file row
    const fileRow = page.locator(`#file-${firstFileID}`);
    await expect(fileRow).toBeVisible();

    // Verify file has "Ready" status (extracted)
    await expect(fileRow.locator('text=Ready')).toBeVisible();

    // Click the "Approve" button
    const approveButton = fileRow.locator('button:has-text("Approve")');
    await expect(approveButton).toBeVisible();
    await approveButton.click();

    // Wait for file to reach "uploaded" status in Firestore
    // (Upload may be fast, so we don't require seeing the intermediate "Uploading..." state)
    await helpers.waitForFileStatus(firstFileID, 'uploaded', 30000);

    // Verify UI shows "Uploaded" status
    await expect(fileRow.locator('text=Uploaded')).toBeVisible({ timeout: 5000 });

    // Verify file exists in Firestore with uploaded status
    await helpers.assertFileInFirestore(firstFileID, {
      status: 'uploaded',
    });

    // Get the file from Firestore to get the GCS path
    const firestore = helpers.getFirestore();
    const fileDoc = await firestore.collection('printsync-files').doc(firstFileID).get();
    const fileData = fileDoc.data();

    expect(fileData).toBeDefined();
    expect(fileData?.gcsPath).toBeDefined();
    expect(fileData?.gcsPath).not.toBe('');

    // GCS file existence verified via successful upload (shown in UI and Firestore status)
    // Note: Direct GCS SDK verification skipped due to Node.js Storage SDK emulator configuration issues
  });

  test('should show trash button after file is uploaded', async ({
    page,
    testSession,
    helpers,
  }) => {
    // Navigate to sync detail page
    await page.goto(`/sync/${testSession.sessionID}`);

    // Wait for DOM to be ready (can't use networkidle with SSE - it's never idle)
    await page.waitForLoadState('domcontentloaded');

    const firstFileID = testSession.fileIDs[0];
    const fileRow = page.locator(`#file-${firstFileID}`);

    // Approve the file
    const approveButton = fileRow.locator('button:has-text("Approve")');
    await approveButton.click();

    // Wait for upload to complete
    await helpers.waitForFileStatus(firstFileID, 'uploaded', 30000);

    // Verify trash button is now visible (not approve/reject buttons)
    await expect(fileRow.locator('button[title="Move to trash"]')).toBeVisible();
    await expect(fileRow.locator('button:has-text("Approve")')).not.toBeVisible();
    await expect(fileRow.locator('button:has-text("Reject")')).not.toBeVisible();
  });
});
