import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile } from '../fixtures/test-data';

test.describe('Bulk Approval with Upload All', () => {
  test('should approve all files with Upload All button', async ({
    page,
    helpers,
  }) => {
    // Create a custom session with 4 extracted files
    const userID = `test-user-${Date.now()}`;
    const rootDir = '/test/documents';

    // Generate 4 test PDF files
    const files = Array.from({ length: 4 }, (_, i) => {
      const pdfFile = generateTestPDFFile({
        localPath: `/test/documents/sample${i + 1}.pdf`,
        status: 'extracted',
      });
      return {
        localPath: pdfFile.localPath,
        hash: pdfFile.hash,
        status: pdfFile.status,
        metadata: pdfFile.metadata,
      };
    });

    // Create session
    const sessionID = await helpers.createTestSession(userID, rootDir, files);

    // Create files
    const fileIDs: string[] = [];
    for (const file of files) {
      const fileID = await helpers.createTestFile(userID, sessionID, file);
      fileIDs.push(fileID);
    }

    // Navigate to sync detail page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Verify all files are visible
    for (const fileID of fileIDs) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();
      await expect(fileRow.locator('text=Ready')).toBeVisible();
    }

    // Click "Upload All" button
    const uploadAllButton = page.locator('#upload-all-btn');
    await expect(uploadAllButton).toBeVisible();
    await uploadAllButton.click();

    // Wait for success message
    await expect(
      page.locator('text=Approving all files... uploads in progress')
    ).toBeVisible({ timeout: 5000 });

    // Wait for all files to reach "uploaded" status in Firestore
    for (const fileID of fileIDs) {
      await helpers.waitForFileStatus(fileID, 'uploaded', 30000);
    }

    // Verify all files show "Uploaded" status in UI
    for (const fileID of fileIDs) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow.locator('text=Uploaded')).toBeVisible({ timeout: 5000 });
    }

    // Verify all files exist in Firestore with uploaded status
    for (const fileID of fileIDs) {
      await helpers.assertFileInFirestore(fileID, {
        status: 'uploaded',
      });
    }

    // Verify all files exist in GCS
    const firestore = helpers.getFirestore();
    const bucket = 'test-bucket'; // Replace with actual bucket name

    for (const fileID of fileIDs) {
      const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
      const fileData = fileDoc.data();
      expect(fileData).toBeDefined();
      expect(fileData?.gcsPath).toBeDefined();
      expect(fileData?.gcsPath).not.toBe('');

      await helpers.assertFileInGCS(bucket, fileData!.gcsPath);
    }
  });

  test('should handle Upload All with mixed file types', async ({
    page,
    helpers,
  }) => {
    const userID = `test-user-${Date.now()}`;
    const rootDir = '/test/documents';

    // Create 2 PDFs and 1 EPUB
    const files = [
      generateTestPDFFile({
        localPath: '/test/documents/doc1.pdf',
        status: 'extracted',
      }),
      generateTestPDFFile({
        localPath: '/test/documents/doc2.pdf',
        status: 'extracted',
      }),
    ].map(f => ({
      localPath: f.localPath,
      hash: f.hash,
      status: f.status,
      metadata: f.metadata,
    }));

    const sessionID = await helpers.createTestSession(userID, rootDir, files);
    const fileIDs: string[] = [];

    for (const file of files) {
      const fileID = await helpers.createTestFile(userID, sessionID, file);
      fileIDs.push(fileID);
    }

    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Click Upload All
    const uploadAllButton = page.locator('#upload-all-btn');
    await uploadAllButton.click();

    // Wait for all to be uploaded
    for (const fileID of fileIDs) {
      await helpers.waitForFileStatus(fileID, 'uploaded', 30000);
    }

    // Verify all uploaded
    for (const fileID of fileIDs) {
      await helpers.assertFileInFirestore(fileID, {
        status: 'uploaded',
      });
    }
  });
});
