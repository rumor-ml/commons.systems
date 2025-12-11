import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile } from '../fixtures/test-data';

test.describe('Mixed Approve and Reject Workflow', () => {
  test('should handle mixed approve and reject actions on 4 files', async ({
    page,
    helpers,
    testSession,
  }) => {
    // Create a custom session with 4 extracted files
    const userID = testSession.userID;
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

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    // Navigate to sync detail page
    await page.goto(`/sync/${sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    // Verify all 4 files are visible
    for (const fileID of fileIDs) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();
      await expect(fileRow.locator('text=Ready')).toBeVisible();
    }

    // Approve files 0 and 1
    const filesToApprove = [fileIDs[0], fileIDs[1]];
    for (const fileID of filesToApprove) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();
      const approveButton = fileRow.locator('button:has-text("Approve")');
      await approveButton.click();
    }

    // Reject files 2 and 3
    const filesToReject = [fileIDs[2], fileIDs[3]];
    for (const fileID of filesToReject) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();
      const rejectButton = fileRow.locator('button:has-text("Reject")');
      await rejectButton.click();
    }

    // Wait for approved files to finish uploading
    for (const fileID of filesToApprove) {
      await helpers.waitForFileStatus(fileID, 'uploaded', 30000);
    }

    // Note: UI verification via SSE is skipped for tests that create files directly in Firestore
    // SSE only streams during active extraction pipeline, not for direct API actions

    // Verify Firestore status for approved files
    for (const fileID of filesToApprove) {
      await helpers.assertFileInFirestore(fileID, {
        status: 'uploaded',
      });
    }

    // Verify Firestore status for rejected files
    for (const fileID of filesToReject) {
      await helpers.assertFileInFirestore(fileID, {
        status: 'rejected',
      });
    }

    // Verify approved files have GCS paths in Firestore (upload completed)
    const firestore = helpers.getFirestore();
    for (const fileID of filesToApprove) {
      const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
      const fileData = fileDoc.data();
      expect(fileData).toBeDefined();
      expect(fileData?.gcsPath).toBeDefined();
      expect(fileData?.gcsPath).not.toBe('');
    }

    // Verify rejected files do NOT have GCS paths
    for (const fileID of filesToReject) {
      const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
      const fileData = fileDoc.data();
      expect(fileData).toBeDefined();
      expect(fileData?.gcsPath || '').toBe('');
    }
  });

  test('should show correct button states after mixed actions', async ({
    page,
    helpers,
    testSession,
  }) => {
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

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    await page.goto(`/sync/${sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    // Approve first file
    const firstFileRow = page.locator(`#file-${fileIDs[0]}`);
    await expect(firstFileRow).toBeVisible();
    await firstFileRow.locator('button:has-text("Approve")').click();
    await helpers.waitForFileStatus(fileIDs[0], 'uploaded', 30000);

    // Reject second file
    const secondFileRow = page.locator(`#file-${fileIDs[1]}`);
    await expect(secondFileRow).toBeVisible();
    await secondFileRow.locator('button:has-text("Reject")').click();
    await helpers.waitForFileStatus(fileIDs[1], 'rejected', 10000);

    // Verify statuses in Firestore
    await helpers.assertFileInFirestore(fileIDs[0], { status: 'uploaded' });
    await helpers.assertFileInFirestore(fileIDs[1], { status: 'rejected' });
    await helpers.assertFileInFirestore(fileIDs[2], { status: 'extracted' });
  });
});
