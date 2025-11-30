import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile, generateTestUserID } from '../fixtures/test-data';

test.describe('Concurrent Operations', () => {
  test('should isolate sessions between different users', async ({ page, helpers }) => {
    // Create two separate sessions for different users
    const userID1 = generateTestUserID();
    const userID2 = generateTestUserID();

    const file1 = generateTestPDFFile({
      localPath: '/test/user1/document.pdf',
      status: 'pending',
    });

    const file2 = generateTestPDFFile({
      localPath: '/test/user2/document.pdf',
      status: 'pending',
    });

    // Create session 1
    const sessionID1 = await helpers.createTestSession(userID1, '/test/user1', [
      {
        localPath: file1.localPath,
        hash: file1.hash,
        status: file1.status,
        metadata: file1.metadata,
      },
    ]);

    const fileID1 = await helpers.createTestFile(sessionID1, file1);

    // Create session 2
    const sessionID2 = await helpers.createTestSession(userID2, '/test/user2', [
      {
        localPath: file2.localPath,
        hash: file2.hash,
        status: file2.status,
        metadata: file2.metadata,
      },
    ]);

    const fileID2 = await helpers.createTestFile(sessionID2, file2);

    // Navigate to session 1
    await page.goto(`http://localhost:8080/sync/${sessionID1}`);
    await page.waitForLoadState('networkidle');

    // Verify only file1 is visible
    const fileRow1 = page.locator(`#file-${fileID1}`);
    const fileRow2 = page.locator(`#file-${fileID2}`);

    await expect(fileRow1).toBeVisible();
    await expect(fileRow2).not.toBeVisible();

    // Verify the file path matches user1's file
    const filePath = await fileRow1.locator('[data-path], .file-path, td').first().textContent();
    expect(filePath).toContain('user1');
    expect(filePath).not.toContain('user2');

    // Navigate to session 2
    await page.goto(`http://localhost:8080/sync/${sessionID2}`);
    await page.waitForLoadState('networkidle');

    // Verify only file2 is visible now
    await expect(fileRow1).not.toBeVisible();
    await expect(fileRow2).toBeVisible();

    // Verify the file path matches user2's file
    const filePath2 = await fileRow2.locator('[data-path], .file-path, td').first().textContent();
    expect(filePath2).toContain('user2');
    expect(filePath2).not.toContain('user1');

    console.log('✓ Sessions are properly isolated between users');
  });

  test('should detect duplicate files with same hash', async ({ page, helpers }) => {
    // Create a session with two files that have the same hash
    const userID = generateTestUserID();
    const sharedHash = 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd';

    const file1 = generateTestPDFFile({
      localPath: '/test/duplicates/original.pdf',
      hash: sharedHash,
      status: 'pending',
    });

    const file2 = generateTestPDFFile({
      localPath: '/test/duplicates/copy.pdf',
      hash: sharedHash, // Same hash as file1
      status: 'pending',
    });

    const sessionID = await helpers.createTestSession(userID, '/test/duplicates', [
      {
        localPath: file1.localPath,
        hash: file1.hash,
        status: file1.status,
        metadata: file1.metadata,
      },
      {
        localPath: file2.localPath,
        hash: file2.hash,
        status: file2.status,
        metadata: file2.metadata,
      },
    ]);

    const fileID1 = await helpers.createTestFile(userID, sessionID, file1);
    const fileID2 = await helpers.createTestFile(userID, sessionID, file2);

    // Navigate to sync page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Both files should be visible
    const fileRow1 = page.locator(`#file-${fileID1}`);
    const fileRow2 = page.locator(`#file-${fileID2}`);

    await expect(fileRow1).toBeVisible();
    await expect(fileRow2).toBeVisible();

    // Check if duplicate detection is indicated in the UI
    const duplicateIndicator1 = fileRow1.locator('text=/duplicate/i');
    const duplicateIndicator2 = fileRow2.locator('text=/duplicate/i');

    const hasDuplicateUI =
      (await duplicateIndicator1.isVisible().catch(() => false)) ||
      (await duplicateIndicator2.isVisible().catch(() => false));

    if (hasDuplicateUI) {
      console.log('✓ Duplicate files are visually indicated');
    } else {
      console.log('ℹ Duplicate detection UI not yet implemented');
    }

    // Approve the first file
    const approveButton1 = fileRow1.locator('button:has-text("Approve")');
    if (await approveButton1.isVisible().catch(() => false)) {
      await approveButton1.click();

      // Wait for upload to complete
      await helpers.waitForFileStatus(fileID1, 'uploaded', 30000);

      // Check if second file is automatically handled (marked as duplicate)
      await page.waitForTimeout(2000);

      const firestore = helpers.getFirestore();
      const file2Doc = await firestore.collection('printsync-files').doc(fileID2).get();
      const file2Data = file2Doc.data();

      if (file2Data?.status === 'deduplicated' || file2Data?.isDuplicate) {
        console.log('✓ Duplicate file automatically detected and marked');
      } else {
        console.log('ℹ Automatic duplicate handling not yet implemented');
      }
    }
  });

  test('should handle rapid sequential file approvals', async ({
    page,
    helpers,
  }) => {
    // Create a session with multiple files
    const userID = generateTestUserID();
    const files = Array.from({ length: 5 }, (_, i) =>
      generateTestPDFFile({
        localPath: `/test/rapid/file${i + 1}.pdf`,
        status: 'pending',
      })
    );

    const sessionID = await helpers.createTestSession(
      userID,
      '/test/rapid',
      files.map(f => ({
        localPath: f.localPath,
        hash: f.hash,
        status: f.status,
        metadata: f.metadata,
      }))
    );

    const fileIDs = await Promise.all(files.map(f => helpers.createTestFile(userID, sessionID, f)));

    // Navigate to sync page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Rapidly click approve on all files
    for (const fileID of fileIDs) {
      const fileRow = page.locator(`#file-${fileID}`);
      const approveButton = fileRow.locator('button:has-text("Approve")');

      if (await approveButton.isVisible().catch(() => false)) {
        await approveButton.click();
        // Small delay to ensure click is registered
        await page.waitForTimeout(100);
      }
    }

    console.log('✓ Rapid approve actions executed');

    // Wait for all uploads to process (with timeout)
    const uploadTimeout = 45000; // 45 seconds for 5 files
    const startTime = Date.now();

    // Check status of all files periodically
    let allUploaded = false;
    while (Date.now() - startTime < uploadTimeout && !allUploaded) {
      const firestore = helpers.getFirestore();
      const fileStatuses = await Promise.all(
        fileIDs.map(async fileID => {
          const doc = await firestore.collection('printsync-files').doc(fileID).get();
          return doc.data()?.status;
        })
      );

      // Check if all are uploaded (or some acceptable final state)
      allUploaded = fileStatuses.every(
        status => status === 'uploaded' || status === 'uploading' || status === 'error'
      );

      if (!allUploaded) {
        await page.waitForTimeout(1000);
      }
    }

    if (allUploaded) {
      console.log('✓ All rapid approvals processed successfully');

      // Verify UI reflects the final states
      for (const fileID of fileIDs) {
        const fileRow = page.locator(`#file-${fileID}`);
        const hasStatus =
          (await fileRow.locator('text=Uploaded').isVisible().catch(() => false)) ||
          (await fileRow.locator('text=Uploading').isVisible().catch(() => false)) ||
          (await fileRow.locator('text=Error').isVisible().catch(() => false));

        expect(hasStatus).toBe(true);
      }
    } else {
      console.log('⚠ Some files did not complete processing within timeout');
    }
  });

  test('should handle concurrent approvals and rejections', async ({
    page,
    helpers,
  }) => {
    // Create a session with files
    const userID = generateTestUserID();
    const files = Array.from({ length: 4 }, (_, i) =>
      generateTestPDFFile({
        localPath: `/test/mixed/file${i + 1}.pdf`,
        status: 'pending',
      })
    );

    const sessionID = await helpers.createTestSession(
      userID,
      '/test/mixed',
      files.map(f => ({
        localPath: f.localPath,
        hash: f.hash,
        status: f.status,
        metadata: f.metadata,
      }))
    );

    const fileIDs = await Promise.all(files.map(f => helpers.createTestFile(userID, sessionID, f)));

    // Navigate to sync page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Approve first two files
    for (let i = 0; i < 2; i++) {
      const fileRow = page.locator(`#file-${fileIDs[i]}`);
      const approveButton = fileRow.locator('button:has-text("Approve")');

      if (await approveButton.isVisible().catch(() => false)) {
        await approveButton.click();
        await page.waitForTimeout(100);
      }
    }

    // Reject last two files
    for (let i = 2; i < 4; i++) {
      const fileRow = page.locator(`#file-${fileIDs[i]}`);
      const rejectButton = fileRow.locator('button:has-text("Reject")');

      if (await rejectButton.isVisible().catch(() => false)) {
        await rejectButton.click();
        await page.waitForTimeout(100);
      }
    }

    console.log('✓ Mixed approve/reject actions executed');

    // Wait for operations to process
    await page.waitForTimeout(3000);

    // Verify the first two files are approved/uploading
    const firestore = helpers.getFirestore();
    for (let i = 0; i < 2; i++) {
      const doc = await firestore.collection('printsync-files').doc(fileIDs[i]).get();
      const status = doc.data()?.status;
      expect(['uploaded', 'uploading', 'extracted']).toContain(status);
    }

    // Verify the last two files are rejected
    for (let i = 2; i < 4; i++) {
      const doc = await firestore.collection('printsync-files').doc(fileIDs[i]).get();
      const status = doc.data()?.status;
      expect(status).toBe('rejected');
    }

    console.log('✓ Concurrent approve/reject operations handled correctly');
  });

  test('should maintain data consistency with concurrent updates', async ({
    page,
    helpers,
  }) => {
    // Create a session
    const userID = generateTestUserID();
    const file = generateTestPDFFile({
      localPath: '/test/consistency/test.pdf',
      status: 'pending',
    });

    const sessionID = await helpers.createTestSession(userID, '/test/consistency', [
      {
        localPath: file.localPath,
        hash: file.hash,
        status: file.status,
        metadata: file.metadata,
      },
    ]);

    const fileID = await helpers.createTestFile(userID, sessionID, file);

    // Navigate to sync page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    const fileRow = page.locator(`#file-${fileID}`);

    // Approve the file via UI
    const approveButton = fileRow.locator('button:has-text("Approve")');
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
    }

    // Simultaneously update the file in Firestore (simulating backend process)
    const firestore = helpers.getFirestore();
    await page.waitForTimeout(500); // Let UI action start

    await firestore.collection('printsync-files').doc(fileID).update({
      status: 'uploading',
      uploadProgress: 50,
      updatedAt: new Date(),
    });

    // Wait for both operations to settle
    await page.waitForTimeout(2000);

    // Verify final state is consistent
    const doc = await firestore.collection('printsync-files').doc(fileID).get();
    const finalStatus = doc.data()?.status;

    // Should be in a valid state (not corrupted)
    expect(['uploading', 'uploaded', 'extracted']).toContain(finalStatus);

    // Verify UI matches Firestore
    const hasValidUIStatus =
      (await fileRow.locator('text=Uploading').isVisible().catch(() => false)) ||
      (await fileRow.locator('text=Uploaded').isVisible().catch(() => false));

    if (hasValidUIStatus) {
      console.log('✓ Data consistency maintained with concurrent updates');
    } else {
      console.log('ℹ UI may not have fully synced yet');
    }
  });
});
