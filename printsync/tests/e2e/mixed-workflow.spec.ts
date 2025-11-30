import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile } from '../fixtures/test-data';

test.describe('Mixed Approve and Reject Workflow', () => {
  test('should handle mixed approve and reject actions on 4 files', async ({
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
      const approveButton = fileRow.locator('button:has-text("Approve")');
      await approveButton.click();

      // Wait for uploading status
      await expect(fileRow.locator('text=Uploading...')).toBeVisible({
        timeout: 5000,
      });
    }

    // Reject files 2 and 3
    const filesToReject = [fileIDs[2], fileIDs[3]];
    for (const fileID of filesToReject) {
      const fileRow = page.locator(`#file-${fileID}`);
      const rejectButton = fileRow.locator('button:has-text("Reject")');
      await rejectButton.click();

      // Wait for rejected status
      await expect(fileRow.locator('text=Rejected')).toBeVisible({ timeout: 5000 });
    }

    // Wait for approved files to finish uploading
    for (const fileID of filesToApprove) {
      await helpers.waitForFileStatus(fileID, 'uploaded', 30000);
    }

    // Verify UI status for approved files
    for (const fileID of filesToApprove) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow.locator('text=Uploaded')).toBeVisible({ timeout: 5000 });
    }

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

    // Verify approved files exist in GCS
    const firestore = helpers.getFirestore();
    const bucket = 'test-bucket';

    for (const fileID of filesToApprove) {
      const fileDoc = await firestore.collection('printsync-files').doc(fileID).get();
      const fileData = fileDoc.data();
      expect(fileData).toBeDefined();
      expect(fileData?.gcsPath).toBeDefined();
      expect(fileData?.gcsPath).not.toBe('');

      await helpers.assertFileInGCS(bucket, fileData!.gcsPath);
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
  }) => {
    const userID = `test-user-${Date.now()}`;
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

    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Approve first file
    const firstFileRow = page.locator(`#file-${fileIDs[0]}`);
    await firstFileRow.locator('button:has-text("Approve")').click();
    await helpers.waitForFileStatus(fileIDs[0], 'uploaded', 30000);

    // Reject second file
    const secondFileRow = page.locator(`#file-${fileIDs[1]}`);
    await secondFileRow.locator('button:has-text("Reject")').click();
    await expect(secondFileRow.locator('text=Rejected')).toBeVisible({ timeout: 5000 });

    // Leave third file in Ready state

    // Verify button states
    // First file (uploaded) should have trash button
    await expect(firstFileRow.locator('button[title="Move to trash"]')).toBeVisible();
    await expect(firstFileRow.locator('button:has-text("Approve")')).not.toBeVisible();

    // Second file (rejected) should have no action buttons
    await expect(secondFileRow.locator('button:has-text("Approve")')).not.toBeVisible();
    await expect(secondFileRow.locator('button:has-text("Reject")')).not.toBeVisible();
    await expect(secondFileRow.locator('button[title="Move to trash"]')).not.toBeVisible();

    // Third file (ready) should have approve and reject buttons
    const thirdFileRow = page.locator(`#file-${fileIDs[2]}`);
    await expect(thirdFileRow.locator('button:has-text("Approve")')).toBeVisible();
    await expect(thirdFileRow.locator('button:has-text("Reject")')).toBeVisible();
  });
});
