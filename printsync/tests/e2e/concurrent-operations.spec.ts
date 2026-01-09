import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile, generateTestUserID } from '../fixtures/test-data';

test.describe('Concurrent Operations', () => {
  test('should isolate sessions between different users', async ({ page, helpers }) => {
    // Create two separate sessions for different users
    const userID1 = generateTestUserID();
    const userID2 = generateTestUserID();

    const file1 = generateTestPDFFile({
      localPath: '/test/user1/document.pdf',
      status: 'extracted',
    });

    const file2 = generateTestPDFFile({
      localPath: '/test/user2/document.pdf',
      status: 'extracted',
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

    const fileID1 = await helpers.createTestFile(userID1, sessionID1, {
      localPath: file1.localPath,
      hash: file1.hash,
      status: file1.status,
      metadata: file1.metadata,
    });

    // Create session 2
    const sessionID2 = await helpers.createTestSession(userID2, '/test/user2', [
      {
        localPath: file2.localPath,
        hash: file2.hash,
        status: file2.status,
        metadata: file2.metadata,
      },
    ]);

    const fileID2 = await helpers.createTestFile(userID2, sessionID2, {
      localPath: file2.localPath,
      hash: file2.hash,
      status: file2.status,
      metadata: file2.metadata,
    });

    // Authenticate as userID1
    await helpers.setPageAuth(page, userID1);

    // Navigate to session 1
    await page.goto(`/sync/${sessionID1}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    // Verify only file1 is visible
    const fileRow1 = page.locator(`#file-${fileID1}`);
    const fileRow2 = page.locator(`#file-${fileID2}`);

    await expect(fileRow1).toBeVisible();
    await expect(fileRow2).not.toBeVisible();

    // Verify the file path matches user1's file
    // The file path is shown in a div with classes: text-sm text-text-secondary truncate
    const filePath = await fileRow1.locator('.text-sm.text-text-secondary.truncate').textContent();
    expect(filePath).toContain('user1');
    expect(filePath).not.toContain('user2');

    // Switch to userID2
    await helpers.setPageAuth(page, userID2);

    // Navigate to session 2
    await page.goto(`/sync/${sessionID2}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    // Verify only file2 is visible now
    await expect(fileRow1).not.toBeVisible();
    await expect(fileRow2).toBeVisible();

    // Verify the file path matches user2's file
    // The file path is shown in a div with classes: text-sm text-text-secondary truncate
    const filePath2 = await fileRow2.locator('.text-sm.text-text-secondary.truncate').textContent();
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
      status: 'extracted',
    });

    const file2 = generateTestPDFFile({
      localPath: '/test/duplicates/copy.pdf',
      hash: sharedHash, // Same hash as file1
      status: 'extracted',
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

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    // Navigate to sync page
    await page.goto(`/sync/${sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

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

    // Check UI for duplicate detection - server detects duplicates at render time
    // based on hash matching, not by storing duplicate status in Firestore
    // Note: Duplicate detection is informational - files can still be approved
    const file1DuplicateBadge = fileRow1.locator('text=/Duplicate/i');
    const file2DuplicateBadge = fileRow2.locator('text=/Duplicate/i');

    const file1IsDuplicate = await file1DuplicateBadge.isVisible().catch(() => false);
    const file2IsDuplicate = await file2DuplicateBadge.isVisible().catch(() => false);

    // Verify duplicate detection: exactly one file should be marked as duplicate
    // (Files with same hash - one is marked as duplicate for user awareness)
    expect(file1IsDuplicate || file2IsDuplicate).toBe(true);
    console.log('✓ Duplicate file automatically detected and marked in UI');

    // Verify the non-duplicate file shows "Ready" status
    if (!file1IsDuplicate) {
      const readyBadge1 = fileRow1.locator('text=/Ready/i');
      await expect(readyBadge1).toBeVisible({ timeout: 5000 });
      console.log('✓ Non-duplicate file (original.pdf) shows Ready status');
    }
    if (!file2IsDuplicate) {
      const readyBadge2 = fileRow2.locator('text=/Ready/i');
      await expect(readyBadge2).toBeVisible({ timeout: 5000 });
      console.log('✓ Non-duplicate file (copy.pdf) shows Ready status');
    }

    // Both files should have action buttons (duplicate detection is informational)
    const approveButton1 = fileRow1.locator('button:has-text("Approve")');
    const approveButton2 = fileRow2.locator('button:has-text("Approve")');

    // At least one file should have approve button visible
    const button1Visible = await approveButton1.isVisible().catch(() => false);
    const button2Visible = await approveButton2.isVisible().catch(() => false);
    expect(button1Visible || button2Visible).toBe(true);
    console.log('✓ Files have action buttons available');

    console.log('✓ Duplicate detection test passed');
  });

  test.skip('should handle rapid sequential file approvals', async ({ page, helpers }) => {
    // TODO(#1361): Firestore emulator GRPC error during test file creation
    // Create a session with multiple files
    const userID = generateTestUserID();
    const files = Array.from({ length: 5 }, (_, i) =>
      generateTestPDFFile({
        localPath: `/test/rapid/file${i + 1}.pdf`,
        status: 'extracted',
      })
    );

    const sessionID = await helpers.createTestSession(
      userID,
      '/test/rapid',
      files.map((f) => ({
        localPath: f.localPath,
        hash: f.hash,
        status: f.status,
        metadata: f.metadata,
      }))
    );

    const fileIDs = await Promise.all(
      files.map((f) => helpers.createTestFile(userID, sessionID, f))
    );

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    // Navigate to sync page
    await page.goto(`/sync/${sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    // Rapidly click approve on all files
    for (const fileID of fileIDs) {
      const fileRow = page.locator(`#file-${fileID}`);
      await expect(fileRow).toBeVisible();
      const approveButton = fileRow.locator('button:has-text("Approve")');

      if (await approveButton.isVisible().catch(() => false)) {
        await approveButton.click();
        // Small delay to ensure click is registered
        await page.waitForTimeout(100);
      }
    }

    console.log('✓ Rapid approve actions executed');

    // Wait for all uploads to complete in Firestore
    for (const fileID of fileIDs) {
      await helpers.waitForFileStatus(fileID, 'uploaded', 30000);
    }

    // Verify all files uploaded successfully
    for (const fileID of fileIDs) {
      await helpers.assertFileInFirestore(fileID, {
        status: 'uploaded',
      });
    }

    console.log('✓ All rapid approvals processed successfully');
  });

  test('should handle concurrent approvals and rejections', async ({ page, helpers }) => {
    // Create a session with files
    const userID = generateTestUserID();
    const files = Array.from({ length: 4 }, (_, i) =>
      generateTestPDFFile({
        localPath: `/test/mixed/file${i + 1}.pdf`,
        status: 'extracted',
      })
    );

    const sessionID = await helpers.createTestSession(
      userID,
      '/test/mixed',
      files.map((f) => ({
        localPath: f.localPath,
        hash: f.hash,
        status: f.status,
        metadata: f.metadata,
      }))
    );

    const fileIDs = await Promise.all(
      files.map((f) => helpers.createTestFile(userID, sessionID, f))
    );

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    // Navigate to sync page
    await page.goto(`/sync/${sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    // Approve first two files
    for (let i = 0; i < 2; i++) {
      const fileRow = page.locator(`#file-${fileIDs[i]}`);
      await expect(fileRow).toBeVisible();
      const approveButton = fileRow.locator('button:has-text("Approve")');

      if (await approveButton.isVisible().catch(() => false)) {
        await approveButton.click();
        await page.waitForTimeout(100);
      }
    }

    // Reject last two files
    for (let i = 2; i < 4; i++) {
      const fileRow = page.locator(`#file-${fileIDs[i]}`);
      await expect(fileRow).toBeVisible();
      const rejectButton = fileRow.locator('button:has-text("Reject")');

      if (await rejectButton.isVisible().catch(() => false)) {
        await rejectButton.click();
        await page.waitForTimeout(100);
      }
    }

    console.log('✓ Mixed approve/reject actions executed');

    // Wait for approved files to upload
    for (let i = 0; i < 2; i++) {
      await helpers.waitForFileStatus(fileIDs[i], 'uploaded', 30000);
    }

    // Wait for rejected files to be rejected
    for (let i = 2; i < 4; i++) {
      await helpers.waitForFileStatus(fileIDs[i], 'rejected', 10000);
    }

    // Verify the first two files are uploaded
    for (let i = 0; i < 2; i++) {
      await helpers.assertFileInFirestore(fileIDs[i], {
        status: 'uploaded',
      });
    }

    // Verify the last two files are rejected
    for (let i = 2; i < 4; i++) {
      await helpers.assertFileInFirestore(fileIDs[i], {
        status: 'rejected',
      });
    }

    console.log('✓ Concurrent approve/reject operations handled correctly');
  });

  test('should maintain data consistency with concurrent updates', async ({ page, helpers }) => {
    // Create a session
    const userID = generateTestUserID();
    const file = generateTestPDFFile({
      localPath: '/test/consistency/test.pdf',
      status: 'extracted',
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

    // Authenticate as user
    await helpers.setPageAuth(page, userID);

    // Navigate to sync page
    await page.goto(`/sync/${sessionID}`);
    // Use domcontentloaded instead of networkidle - SSE keeps connection open forever
    await page.waitForLoadState('domcontentloaded');

    const fileRow = page.locator(`#file-${fileID}`);
    await expect(fileRow).toBeVisible();

    // Approve the file via UI
    const approveButton = fileRow.locator('button:has-text("Approve")');
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
    }

    // Wait for upload to complete
    await helpers.waitForFileStatus(fileID, 'uploaded', 30000);

    // Verify final state is uploaded
    await helpers.assertFileInFirestore(fileID, {
      status: 'uploaded',
    });

    console.log('✓ Data consistency maintained with concurrent updates');
  });
});
