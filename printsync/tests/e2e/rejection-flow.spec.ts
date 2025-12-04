import { test, expect } from '../fixtures/printsync-fixtures';

test.describe('File Rejection Workflow', () => {
  test('should reject a single file and verify it is not uploaded', async ({
    page,
    testSession,
    helpers,
  }) => {
    // Navigate to sync detail page
    await page.goto(`/sync/${testSession.sessionID}`);
    await page.waitForLoadState('networkidle');

    // Get the first file ID
    const firstFileID = testSession.fileIDs[0];

    // Find the file row
    const fileRow = page.locator(`#file-${firstFileID}`);
    await expect(fileRow).toBeVisible();

    // Verify file has "Ready" status (extracted)
    await expect(fileRow.locator('text=Ready')).toBeVisible();

    // Click the "Reject" button
    const rejectButton = fileRow.locator('button:has-text("Reject")');
    await expect(rejectButton).toBeVisible();
    await rejectButton.click();

    // Wait for UI to show "Rejected" status
    await expect(fileRow.locator('text=Rejected')).toBeVisible({ timeout: 5000 });

    // Verify file status is "rejected" in Firestore
    await helpers.waitForFileStatus(firstFileID, 'rejected', 10000);

    await helpers.assertFileInFirestore(firstFileID, {
      status: 'rejected',
    });

    // Verify file does NOT exist in GCS
    const firestore = helpers.getFirestore();
    const fileDoc = await firestore.collection('printsync-files').doc(firstFileID).get();
    const fileData = fileDoc.data();

    expect(fileData).toBeDefined();

    // gcsPath should be empty or undefined for rejected files
    expect(fileData?.gcsPath || '').toBe('');

    // Verify no approve/reject/trash buttons are shown for rejected files
    await expect(fileRow.locator('button:has-text("Approve")')).not.toBeVisible();
    await expect(fileRow.locator('button:has-text("Reject")')).not.toBeVisible();
    await expect(fileRow.locator('button[title="Move to trash"]')).not.toBeVisible();
  });

  test('should allow rejecting multiple files in sequence', async ({
    page,
    testSession,
    helpers,
  }) => {
    await page.goto(`/sync/${testSession.sessionID}`);
    await page.waitForLoadState('networkidle');

    // Reject the first two files
    const fileIDsToReject = testSession.fileIDs.slice(0, 2);

    for (const fileID of fileIDsToReject) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();

      const rejectButton = fileRow.locator('button:has-text("Reject")');
      await rejectButton.click();

      // Wait for rejected status
      await expect(fileRow.locator('text=Rejected')).toBeVisible({ timeout: 5000 });
    }

    // Verify both files are rejected in Firestore
    for (const fileID of fileIDsToReject) {
      await helpers.assertFileInFirestore(fileID, {
        status: 'rejected',
      });
    }

    // Verify the third file is still in Ready state
    const thirdFileID = testSession.fileIDs[2];
    const thirdFileRow = page.locator(`#file-${thirdFileID}`);
    await expect(thirdFileRow.locator('text=Ready')).toBeVisible();
    await expect(thirdFileRow.locator('button:has-text("Approve")')).toBeVisible();
    await expect(thirdFileRow.locator('button:has-text("Reject")')).toBeVisible();
  });

  test('should maintain rejected status after page reload', async ({
    page,
    testSession,
    helpers,
  }) => {
    await page.goto(`/sync/${testSession.sessionID}`);
    await page.waitForLoadState('networkidle');

    const firstFileID = testSession.fileIDs[0];
    const fileRow = page.locator(`#file-${firstFileID}`);

    // Reject the file
    const rejectButton = fileRow.locator('button:has-text("Reject")');
    await rejectButton.click();
    await expect(fileRow.locator('text=Rejected')).toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify file still shows as rejected
    const reloadedFileRow = page.locator(`#file-${firstFileID}`);
    await expect(reloadedFileRow.locator('text=Rejected')).toBeVisible();

    // Verify status in Firestore
    await helpers.assertFileInFirestore(firstFileID, {
      status: 'rejected',
    });
  });
});
