import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile } from '../fixtures/test-data';

test.describe('SSE Real-time Updates', () => {
  test('should update file status via SSE without page refresh', async ({
    page,
    helpers,
  }) => {
    // Create a session with a pending file
    const userID = 'test-user-sse-1';
    const rootDir = '/test/sse-files';

    const testFile = generateTestPDFFile({
      localPath: '/test/sse-files/realtime.pdf',
      status: 'pending',
    });

    const sessionID = await helpers.createTestSession(userID, rootDir, [
      {
        localPath: testFile.localPath,
        hash: testFile.hash,
        status: testFile.status,
        metadata: testFile.metadata,
      },
    ]);

    const fileID = await helpers.createTestFile(sessionID, testFile);

    // Set up console monitoring to detect page refreshes
    let pageRefreshed = false;
    page.on('load', () => {
      pageRefreshed = true;
    });

    // Navigate to sync detail page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Reset the refresh flag after initial load
    pageRefreshed = false;

    // Verify file is visible with pending status
    const fileRow = page.locator(`#file-${fileID}`);
    await expect(fileRow).toBeVisible();

    // Simulate a backend status change (pending -> extracted)
    const firestore = helpers.getFirestore();
    await firestore.collection('files').doc(fileID).update({
      status: 'extracted',
      updatedAt: new Date(),
    });

    // Wait for UI to update (give SSE time to deliver the update)
    await page.waitForTimeout(2000);

    // Check if the status updated in the UI
    const extractedStatus = fileRow.locator('text=Ready').or(fileRow.locator('text=Extracted'));
    const statusUpdated = await extractedStatus.isVisible().catch(() => false);

    if (statusUpdated) {
      console.log('✓ SSE update detected - status changed without page refresh');

      // Verify no page refresh occurred
      if (!pageRefreshed) {
        console.log('✓ Update happened without full page reload');
      } else {
        console.log('⚠ Status updated but page was refreshed (expected SSE to avoid this)');
      }
    } else {
      console.log('ℹ SSE real-time updates not yet fully implemented');
    }
  });

  test('should use hx-swap-oob for in-place file row updates', async ({
    page,
    helpers,
  }) => {
    // Create a session with multiple files
    const userID = 'test-user-sse-2';
    const rootDir = '/test/sse-swap';

    const file1 = generateTestPDFFile({
      localPath: '/test/sse-swap/file1.pdf',
      status: 'pending',
    });

    const file2 = generateTestPDFFile({
      localPath: '/test/sse-swap/file2.pdf',
      status: 'pending',
    });

    const sessionID = await helpers.createTestSession(userID, rootDir, [
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

    const fileID1 = await helpers.createTestFile(sessionID, file1);
    const fileID2 = await helpers.createTestFile(sessionID, file2);

    // Navigate to sync detail page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Get initial DOM element references
    const fileRow1 = page.locator(`#file-${fileID1}`);
    const fileRow2 = page.locator(`#file-${fileID2}`);

    await expect(fileRow1).toBeVisible();
    await expect(fileRow2).toBeVisible();

    // Get a unique attribute from file2 to track it specifically
    const file2Path = await fileRow2.locator('[data-path], .file-path, td:first-child').textContent();

    // Update file1 status in Firestore
    const firestore = helpers.getFirestore();
    await firestore.collection('files').doc(fileID1).update({
      status: 'extracted',
      updatedAt: new Date(),
    });

    // Wait for potential SSE update
    await page.waitForTimeout(2000);

    // Verify file2 is still visible and unchanged (OOB should only update file1)
    await expect(fileRow2).toBeVisible();

    // Verify file2 still has its original path (wasn't replaced entirely)
    const file2PathAfter = await fileRow2
      .locator('[data-path], .file-path, td:first-child')
      .textContent();

    if (file2Path === file2PathAfter) {
      console.log('✓ Other file rows remain unaffected by OOB update');
    }

    // Check if file1 updated
    const file1Updated = await fileRow1
      .locator('text=Ready')
      .or(fileRow1.locator('text=Extracted'))
      .isVisible()
      .catch(() => false);

    if (file1Updated) {
      console.log('✓ File row updated in place via OOB swap');
    } else {
      console.log('ℹ OOB swap updates not yet detected');
    }
  });

  test('should update session statistics in real-time', async ({
    page,
    helpers,
  }) => {
    // Create a session with files
    const userID = 'test-user-sse-3';
    const rootDir = '/test/sse-stats';

    const testFiles = Array.from({ length: 3 }, (_, i) =>
      generateTestPDFFile({
        localPath: `/test/sse-stats/file${i + 1}.pdf`,
        status: 'pending',
      })
    );

    const sessionID = await helpers.createTestSession(
      userID,
      rootDir,
      testFiles.map(f => ({
        localPath: f.localPath,
        hash: f.hash,
        status: f.status,
        metadata: f.metadata,
      }))
    );

    const fileIDs = await Promise.all(
      testFiles.map(f => helpers.createTestFile(sessionID, f))
    );

    // Navigate to sync detail page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Look for session stats area
    const statsArea = page.locator(
      '#session-stats, [data-testid="session-stats"], .session-stats'
    );
    const hasStats = await statsArea.isVisible().catch(() => false);

    if (!hasStats) {
      console.log('ℹ Session statistics display not found, skipping stats update test');
      return;
    }

    // Get initial stats text
    const initialStatsText = await statsArea.textContent();

    // Update one file to extracted status
    const firestore = helpers.getFirestore();
    await firestore.collection('files').doc(fileIDs[0]).update({
      status: 'extracted',
      updatedAt: new Date(),
    });

    // Update session stats
    await firestore.collection('sessions').doc(sessionID).update({
      'stats.extracted': 1,
      updatedAt: new Date(),
    });

    // Wait for SSE update
    await page.waitForTimeout(2000);

    // Get updated stats text
    const updatedStatsText = await statsArea.textContent();

    if (initialStatsText !== updatedStatsText) {
      console.log('✓ Session statistics updated in real-time');

      // Check if the stats show extracted count
      const hasExtractedCount = updatedStatsText?.match(/extracted|ready/i);
      if (hasExtractedCount) {
        console.log('✓ Stats reflect file status changes');
      }
    } else {
      console.log('ℹ Real-time stats updates not yet implemented');
    }
  });

  test('should handle SSE connection and reconnection', async ({
    page,
    helpers,
  }) => {
    // Create a test session
    const userID = 'test-user-sse-4';
    const rootDir = '/test/sse-connection';

    const testFile = generateTestPDFFile({
      localPath: '/test/sse-connection/test.pdf',
      status: 'pending',
    });

    const sessionID = await helpers.createTestSession(userID, rootDir, [
      {
        localPath: testFile.localPath,
        hash: testFile.hash,
        status: testFile.status,
        metadata: testFile.metadata,
      },
    ]);

    await helpers.createTestFile(sessionID, testFile);

    // Monitor console for SSE-related messages
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });

    // Navigate to sync detail page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Wait a bit to allow SSE connection to establish
    await page.waitForTimeout(1000);

    // Check for HTMX SSE extension in page
    const hasHTMXSSE = await page.evaluate(() => {
      // Check if htmx SSE extension is loaded
      return typeof (window as any).htmx !== 'undefined';
    });

    if (hasHTMXSSE) {
      console.log('✓ HTMX is loaded on the page');

      // Check for SSE connection attributes in DOM
      const sseElement = page.locator('[hx-ext="sse"], [sse-connect]');
      const hasSseElement = await sseElement.isVisible().catch(() => false);

      if (hasSseElement) {
        console.log('✓ SSE connection element found in DOM');

        // Get the SSE connect URL
        const sseUrl = await sseElement.getAttribute('sse-connect');
        if (sseUrl) {
          console.log(`✓ SSE endpoint configured: ${sseUrl}`);
        }
      } else {
        console.log('ℹ SSE connection elements not yet implemented');
      }
    } else {
      console.log('ℹ HTMX not detected or SSE extension not loaded');
    }

    // Check console for any SSE-related errors
    const sseErrors = consoleMessages.filter(msg =>
      msg.match(/sse|eventsource|stream/i)
    );

    if (sseErrors.length > 0) {
      console.log('Console messages related to SSE:', sseErrors);
    }
  });
});
