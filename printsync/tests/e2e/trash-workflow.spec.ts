import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile } from '../fixtures/test-data';

test.describe('Trash Workflow', () => {
  test('should trash a single uploaded file and remove from GCS', async ({
    page,
    helpers,
    testSession,
  }) => {
    // Create session with one file
    const userID = testSession.userID;
    const rootDir = '/test/documents';

    const file = generateTestPDFFile({
      localPath: '/test/documents/sample.pdf',
      status: 'extracted',
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
    });

    // Navigate to sync detail page
    await page.goto(`/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Approve the file first
    const fileRow = page.locator(`#file-${fileID}`);
    const approveButton = fileRow.locator('button:has-text("Approve")');
    await approveButton.click();

    // Wait for upload to complete
    await helpers.waitForFileStatus(fileID, 'uploaded', 30000);
    await expect(fileRow.locator('text=Uploaded')).toBeVisible({ timeout: 5000 });

    // Get the GCS path before trashing
    const firestore = helpers.getFirestore();
    const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
    const fileData = fileDoc.data();
    expect(fileData).toBeDefined();
    expect(fileData?.gcsPath).toBeDefined();

    const gcsPath = fileData!.gcsPath;
    const bucket = 'test-bucket';

    // Verify file exists in GCS
    await helpers.assertFileInGCS(bucket, gcsPath);

    // Click trash button (opens modal)
    const trashButton = fileRow.locator('button[title="Move to trash"]');
    await expect(trashButton).toBeVisible();
    await trashButton.click();

    // Wait for modal to appear and confirm
    const modal = page.locator('.modal-content, [role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Find and click confirm button in modal
    const confirmButton = modal.locator('button:has-text("Trash"), button:has-text("Delete"), button:has-text("Confirm")');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify file is removed from GCS
    // Note: We expect this to throw because the file should not exist
    const storage = helpers.getStorage();
    const gcsFile = storage.bucket(bucket).file(gcsPath);
    const [exists] = await gcsFile.exists();
    expect(exists).toBe(false);
  });

  test('should trash all uploaded files with Trash All button', async ({
    page,
    helpers,
    testSession,
  }) => {
    // Create session with 3 files
    const userID = testSession.userID;
    const rootDir = '/test/documents';

    const files = Array.from({ length: 3 }, (_, i) => {
      const pdfFile = generateTestPDFFile({
        localPath: `/test/documents/file${i + 1}.pdf`,
        status: 'extracted',
      });
      return {
        localPath: pdfFile.localPath,
        hash: pdfFile.hash,
        status: pdfFile.status,
        metadata: pdfFile.metadata,
      };
    });

    const sessionID = await helpers.createTestSession(userID, rootDir, files);
    const fileIDs: string[] = [];

    for (const file of files) {
      const fileID = await helpers.createTestFile(userID, sessionID, file);
      fileIDs.push(fileID);
    }

    await page.goto(`/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Approve all files using Upload All
    const uploadAllButton = page.locator('#upload-all-btn');
    await uploadAllButton.click();

    // Wait for all to be uploaded
    for (const fileID of fileIDs) {
      await helpers.waitForFileStatus(fileID, 'uploaded', 30000);
    }

    // Collect GCS paths
    const firestore = helpers.getFirestore();
    const gcsPaths: string[] = [];

    for (const fileID of fileIDs) {
      const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
      const fileData = fileDoc.data();
      expect(fileData).toBeDefined();
      expect(fileData?.gcsPath).toBeDefined();
      gcsPaths.push(fileData!.gcsPath);
    }

    const bucket = 'test-bucket';

    // Verify all files exist in GCS
    for (const gcsPath of gcsPaths) {
      await helpers.assertFileInGCS(bucket, gcsPath);
    }

    // Click "Trash All" button
    const trashAllButton = page.locator('#trash-all-btn');
    await expect(trashAllButton).toBeVisible();
    await trashAllButton.click();

    // Wait for modal and confirm
    const modal = page.locator('.modal-content, [role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const confirmButton = modal.locator('button:has-text("Trash"), button:has-text("Delete"), button:has-text("Confirm")');
    await confirmButton.click();

    // Wait for success message
    await expect(page.locator('text=/Trashed \\d+ file/i')).toBeVisible({
      timeout: 10000,
    });

    // Verify all files are removed from GCS
    const storage = helpers.getStorage();

    for (const gcsPath of gcsPaths) {
      const gcsFile = storage.bucket(bucket).file(gcsPath);
      const [exists] = await gcsFile.exists();
      expect(exists).toBe(false);
    }
  });

  test('should only trash uploaded/skipped files, not rejected ones', async ({
    page,
    helpers,
    testSession,
  }) => {
    // Create session with 3 files
    const userID = testSession.userID;
    const rootDir = '/test/documents';

    const files = Array.from({ length: 3 }, (_, i) => {
      const pdfFile = generateTestPDFFile({
        localPath: `/test/documents/doc${i + 1}.pdf`,
        status: 'extracted',
      });
      return {
        localPath: pdfFile.localPath,
        hash: pdfFile.hash,
        status: pdfFile.status,
        metadata: pdfFile.metadata,
      };
    });

    const sessionID = await helpers.createTestSession(userID, rootDir, files);
    const fileIDs: string[] = [];

    for (const file of files) {
      const fileID = await helpers.createTestFile(userID, sessionID, file);
      fileIDs.push(fileID);
    }

    await page.goto(`/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Approve first two files
    for (const fileID of fileIDs.slice(0, 2)) {
      const fileRow = page.locator(`#file-${fileID}`);
      await fileRow.locator('button:has-text("Approve")').click();
    }

    // Wait for uploads to complete
    for (const fileID of fileIDs.slice(0, 2)) {
      await helpers.waitForFileStatus(fileID, 'uploaded', 30000);
    }

    // Reject third file
    const thirdFileRow = page.locator(`#file-${fileIDs[2]}`);
    await thirdFileRow.locator('button:has-text("Reject")').click();
    await expect(thirdFileRow.locator('text=Rejected')).toBeVisible({ timeout: 5000 });

    // Verify third file has no trash button
    await expect(thirdFileRow.locator('button[title="Move to trash"]')).not.toBeVisible();

    // Click Trash All
    const trashAllButton = page.locator('#trash-all-btn');
    await trashAllButton.click();

    // Confirm in modal
    const modal = page.locator('.modal-content, [role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    const confirmButton = modal.locator('button:has-text("Trash"), button:has-text("Delete"), button:has-text("Confirm")');
    await confirmButton.click();

    // Should show trashed 2 files (not 3)
    await expect(page.locator('text=Trashed 2 file')).toBeVisible({ timeout: 10000 });

    // Verify only the first two files were trashed from GCS
    const firestore = helpers.getFirestore();
    const storage = helpers.getStorage();
    const bucket = 'test-bucket';

    for (const fileID of fileIDs.slice(0, 2)) {
      const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
      const fileData = fileDoc.data();
      const gcsFile = storage.bucket(bucket).file(fileData!.gcsPath);
      const [exists] = await gcsFile.exists();
      expect(exists).toBe(false);
    }

    // Verify rejected file still has no GCS path
    const rejectedDoc = await firestore.collection('printsync-files').doc(fileIDs[2]).get();
    const rejectedData = rejectedDoc.data();
    expect(rejectedData?.gcsPath || '').toBe('');
  });
});
