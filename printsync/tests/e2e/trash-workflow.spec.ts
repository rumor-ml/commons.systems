import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile } from '../fixtures/test-data';

test.describe('Trash Workflow', () => {
  test('should trash a single uploaded file', async ({ page, helpers, testSession }) => {
    // Create session with one file already in 'uploaded' state
    // (bypassing actual upload to avoid GCS emulator issues)
    const userID = testSession.userID;
    const rootDir = '/test/documents';

    const file = generateTestPDFFile({
      localPath: '/test/documents/sample.pdf',
      status: 'uploaded', // Already uploaded
    });

    const sessionID = await helpers.createTestSession(userID, rootDir, [
      {
        localPath: file.localPath,
        hash: file.hash,
        status: file.status,
        metadata: file.metadata,
      },
    ]);

    const fileID = await helpers.createTestFile(userID, sessionID, {
      localPath: file.localPath,
      hash: file.hash,
      status: file.status,
      metadata: file.metadata,
      gcsPath: `users/${userID}/files/${file.hash}.pdf`, // Mock GCS path
    });

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    // Navigate to sync detail page
    await page.goto(`/sync/${sessionID}`);
    await page.waitForLoadState('domcontentloaded');

    // Verify file is visible with uploaded status
    const fileRow = page.locator(`#file-${fileID}`);
    await expect(fileRow).toBeVisible();
    const uploadedStatus = fileRow.locator('text=Uploaded');
    await expect(uploadedStatus).toBeVisible();

    // Click trash button (opens modal)
    const trashButton = fileRow.locator('button[title="Move to trash"]');
    await expect(trashButton).toBeVisible();
    await trashButton.click();

    // Wait for modal to appear and confirm
    const modal = page.locator('#trash-modal .modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Find and click confirm button in modal
    const confirmButton = modal.locator('button:has-text("Trash File")');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Wait for modal to close
    await expect(page.locator('#trash-modal')).not.toBeVisible({ timeout: 5000 });

    // Verify file status changed to trashed in Firestore
    await helpers.waitForFileStatus(fileID, 'trashed', 10000);

    // Verify Firestore shows trashed status
    const firestore = helpers.getFirestore();
    const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
    const fileData = fileDoc.data();
    expect(fileData?.status).toBe('trashed');
  });

  test('should trash all uploaded files with Trash All button', async ({
    page,
    helpers,
    testSession,
  }) => {
    // Create session with 3 files already in 'uploaded' state
    const userID = testSession.userID;
    const rootDir = '/test/documents';

    const files = Array.from({ length: 3 }, (_, i) => {
      const pdfFile = generateTestPDFFile({
        localPath: `/test/documents/file${i + 1}.pdf`,
        status: 'uploaded', // Already uploaded
      });
      return {
        localPath: pdfFile.localPath,
        hash: pdfFile.hash,
        status: pdfFile.status,
        metadata: pdfFile.metadata,
        gcsPath: `users/${userID}/files/${pdfFile.hash}.pdf`, // Mock GCS path
      };
    });

    const sessionID = await helpers.createTestSession(userID, rootDir, files);
    const fileIDs: string[] = [];

    for (const file of files) {
      const fileID = await helpers.createTestFile(userID, sessionID, file);
      fileIDs.push(fileID);
    }

    // Update session stats to reflect file statuses (needed for UI to show correct buttons)
    await helpers.updateSessionStats(sessionID, files);

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    await page.goto(`/sync/${sessionID}`);
    await page.waitForLoadState('domcontentloaded');

    // Verify all files are visible with uploaded status
    for (const fileID of fileIDs) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();
    }

    // Wait for "Trash All" button to appear (button is rendered based on stats.Uploaded + stats.Skipped > 0)
    const trashAllButton = page.locator('#trash-all-btn');

    // Wait for button to exist in DOM (may take time for SSE to deliver stats)
    await trashAllButton.waitFor({ state: 'attached', timeout: 15000 });

    // Show it programmatically in case it's hidden
    await page.evaluate(() => {
      const btn = document.querySelector('#trash-all-btn');
      if (btn) btn.classList.remove('hidden');
    });
    await expect(trashAllButton).toBeVisible();
    await trashAllButton.click();

    // Wait for modal and confirm
    const modal = page.locator('#trash-modal .modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const confirmButton = modal.locator('button:has-text("Trash All")');
    await confirmButton.click();

    // Wait for modal to close
    await expect(page.locator('#trash-modal')).not.toBeVisible({ timeout: 5000 });

    // Verify all files are trashed in Firestore
    const firestore = helpers.getFirestore();
    for (const fileID of fileIDs) {
      await helpers.waitForFileStatus(fileID, 'trashed', 10000);
      const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
      const fileData = fileDoc.data();
      expect(fileData?.status).toBe('trashed');
    }
  });

  test('should only trash uploaded/skipped files, not rejected ones', async ({
    page,
    helpers,
    testSession,
  }) => {
    // Create session with 3 files: 2 uploaded, 1 rejected
    const userID = testSession.userID;
    const rootDir = '/test/documents';

    // First two files are uploaded with GCS paths
    const uploadedFiles = Array.from({ length: 2 }, (_, i) => {
      const pdfFile = generateTestPDFFile({
        localPath: `/test/documents/doc${i + 1}.pdf`,
        status: 'uploaded',
      });
      return {
        localPath: pdfFile.localPath,
        hash: pdfFile.hash,
        status: pdfFile.status,
        metadata: pdfFile.metadata,
        gcsPath: `users/${userID}/files/${pdfFile.hash}.pdf`,
      };
    });

    // Third file is rejected (no GCS path)
    const rejectedFile = generateTestPDFFile({
      localPath: '/test/documents/doc3.pdf',
      status: 'rejected',
    });

    const allFiles = [
      ...uploadedFiles,
      {
        localPath: rejectedFile.localPath,
        hash: rejectedFile.hash,
        status: rejectedFile.status,
        metadata: rejectedFile.metadata,
        gcsPath: '', // Rejected files have no GCS path
      },
    ];

    const sessionID = await helpers.createTestSession(userID, rootDir, allFiles);
    const fileIDs: string[] = [];

    for (const file of allFiles) {
      const fileID = await helpers.createTestFile(userID, sessionID, file);
      fileIDs.push(fileID);
    }

    // Update session stats to reflect file statuses (needed for UI to show correct buttons)
    await helpers.updateSessionStats(sessionID, allFiles);

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    await page.goto(`/sync/${sessionID}`);
    await page.waitForLoadState('domcontentloaded');

    // Verify all files are visible
    for (const fileID of fileIDs) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();
    }

    // Wait for "Trash All" button to appear (button is rendered based on stats.Uploaded + stats.Skipped > 0)
    const trashAllButton = page.locator('#trash-all-btn');

    // Wait for button to exist in DOM (should be immediate since stats are set)
    await trashAllButton.waitFor({ state: 'attached', timeout: 15000 });

    // Show it programmatically in case it's hidden
    await page.evaluate(() => {
      const btn = document.querySelector('#trash-all-btn');
      if (btn) btn.classList.remove('hidden');
    });
    await expect(trashAllButton).toBeVisible();
    await trashAllButton.click();

    // Confirm in modal
    const modal = page.locator('#trash-modal .modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    const confirmButton = modal.locator('button:has-text("Trash All")');
    await confirmButton.click();

    // Wait for modal to close
    await expect(page.locator('#trash-modal')).not.toBeVisible({ timeout: 5000 });

    // Verify the first two files are trashed in Firestore
    const firestore = helpers.getFirestore();
    for (const fileID of fileIDs.slice(0, 2)) {
      await helpers.waitForFileStatus(fileID, 'trashed', 10000);
      const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
      const fileData = fileDoc.data();
      expect(fileData?.status).toBe('trashed');
    }

    // Verify rejected file is still rejected (not trashed)
    const rejectedDoc = await firestore.collection('printsync-files').doc(fileIDs[2]).get();
    const rejectedData = rejectedDoc.data();
    expect(rejectedData?.status).toBe('rejected');
  });
});
