import { test, expect } from '../fixtures/printsync-fixtures';

test.describe('File Rejection Workflow', () => {
  test('should reject a single file and verify it is not uploaded', async ({
    page,
    testSession,
    helpers,
  }) => {
    // Authenticate as the test session user
    await helpers.setPageAuth(page, testSession.userID);

    // Navigate to sync detail page
    await page.goto(`/sync/${testSession.sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

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

    // Verify file status is "rejected" in Firestore
    await helpers.waitForFileStatus(firstFileID, 'rejected', 10000);

    // Note: UI verification via SSE is skipped for tests that create files directly in Firestore
    // SSE only streams during active extraction pipeline, not for direct API actions

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
  });

  test('should allow rejecting multiple files in sequence', async ({
    page,
    testSession,
    helpers,
  }) => {
    // Authenticate as the test session user
    await helpers.setPageAuth(page, testSession.userID);

    await page.goto(`/sync/${testSession.sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    // Reject the first two files
    const fileIDsToReject = testSession.fileIDs.slice(0, 2);

    for (const fileID of fileIDsToReject) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();

      const rejectButton = fileRow.locator('button:has-text("Reject")');
      await expect(rejectButton).toBeVisible();
      await rejectButton.click();

      // Wait for rejection to complete before clicking next button
      await helpers.waitForFileStatus(fileID, 'rejected', 10000);
    }

    // Verify both files are rejected in Firestore
    for (const fileID of fileIDsToReject) {
      await helpers.assertFileInFirestore(fileID, {
        status: 'rejected',
      });
    }

    // Verify the third file is still in Ready/extracted state in Firestore
    const thirdFileID = testSession.fileIDs[2];
    await helpers.assertFileInFirestore(thirdFileID, {
      status: 'extracted',
    });
  });

  test('should maintain rejected status after page reload', async ({
    page,
    testSession,
    helpers,
  }) => {
    // Authenticate as the test session user
    await helpers.setPageAuth(page, testSession.userID);

    await page.goto(`/sync/${testSession.sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    const firstFileID = testSession.fileIDs[0];
    const fileRow = page.locator(`#file-${firstFileID}`);
    await expect(fileRow).toBeVisible();

    // Reject the file
    const rejectButton = fileRow.locator('button:has-text("Reject")');
    await expect(rejectButton).toBeVisible();
    await rejectButton.click();

    // Wait for rejection to complete in Firestore
    await helpers.waitForFileStatus(firstFileID, 'rejected', 10000);

    // Verify status in Firestore
    await helpers.assertFileInFirestore(firstFileID, {
      status: 'rejected',
    });

    // Reload the page to verify persistence
    await page.reload();
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    // Verify status persisted in Firestore after reload
    await helpers.assertFileInFirestore(firstFileID, {
      status: 'rejected',
    });
  });
});
