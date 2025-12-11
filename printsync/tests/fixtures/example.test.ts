/**
 * Example test file demonstrating how to use the PrintSync fixtures
 *
 * This file shows the usage patterns for the E2E testing infrastructure.
 * Delete or move this file when creating actual tests.
 */

import { test, expect } from './printsync-fixtures';
import { generateTestPDFFile, generateTestUserID } from './test-data';

// Example 1: Using the helpers fixture
test('example: create and verify a test session', async ({ helpers }) => {
  const userID = generateTestUserID();
  const rootDir = '/test/documents';
  const files = [generateTestPDFFile()];

  // Create a test session
  const sessionID = await helpers.createTestSession(userID, rootDir, [
    {
      localPath: files[0].localPath,
      hash: files[0].hash,
      status: files[0].status,
      metadata: files[0].metadata,
    },
  ]);

  // Verify session was created
  const firestore = helpers.getFirestore();
  const sessionDoc = await firestore.collection('sessions').doc(sessionID).get();

  expect(sessionDoc.exists).toBe(true);
  expect(sessionDoc.data()?.userID).toBe(userID);

  // Cleanup is automatic via the helpers fixture
});

// Example 2: Using the pre-seeded testSession fixture
test('example: use pre-seeded session', async ({ testSession, helpers }) => {
  // testSession already has 2 PDFs and 1 EPUB created
  expect(testSession.fileIDs).toHaveLength(3);

  // You can verify the files exist
  for (const fileID of testSession.fileIDs) {
    await helpers.assertFileInFirestore(fileID, {
      sessionID: testSession.sessionID,
      status: 'pending',
    });
  }

  // Cleanup is automatic
});

// Example 3: Creating and monitoring file status changes
test('example: wait for file status change', async ({ helpers }) => {
  const userID = generateTestUserID();
  const file = generateTestPDFFile();

  const sessionID = await helpers.createTestSession(userID, '/test', [
    {
      localPath: file.localPath,
      hash: file.hash,
      status: 'pending',
      metadata: file.metadata,
    },
  ]);

  const fileID = await helpers.createTestFile(sessionID, {
    localPath: file.localPath,
    hash: file.hash,
    status: 'pending',
  });

  // Simulate status update (in real test, this would be done by the backend)
  const firestore = helpers.getFirestore();
  await firestore.collection('files').doc(fileID).update({
    status: 'uploaded',
  });

  // Wait for the status to change
  await helpers.waitForFileStatus(fileID, 'uploaded', 5000);

  // Verify the status
  await helpers.assertFileInFirestore(fileID, {
    status: 'uploaded',
  });
});

// Example 4: Testing with browser interactions
test('example: browser interaction with test data', async ({ page, testSession }) => {
  // This is where you'd navigate to your app and test it
  // The testSession provides real data in Firestore for the app to use

  // Example (adjust URL based on your app):
  // await page.goto(`/sessions/${testSession.sessionID}`);
  // await expect(page.locator('.file-item')).toHaveCount(3);

  console.log('Session ID:', testSession.sessionID);
  console.log('File IDs:', testSession.fileIDs);
});
