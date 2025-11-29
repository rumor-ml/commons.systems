import { test, expect } from '../fixtures/{{APP_NAME}}-fixtures';

/**
 * Example E2E test demonstrating testing patterns with emulators
 *
 * This test shows how to:
 * - Use the TestHelpers fixture to seed and verify test data
 * - Wait for async operations to complete in Firestore
 * - Verify data in both the UI and backend (Firestore/GCS)
 * - Test real-time updates with proper synchronization
 */
test.describe('Example Workflow', () => {
  test('should create and process an item through full workflow', async ({
    page,
    helpers,
  }) => {
    // === STEP 1: Seed test data in Firestore ===
    // Create a test item that will appear in the UI
    const itemID = await helpers.createItem('{{APP_NAME}}-items', {
      name: 'Test Item',
      status: 'pending',
      description: 'This is a test item',
    });

    // === STEP 2: Navigate to the UI and verify item appears ===
    await page.goto('http://localhost:8080/items');
    await page.waitForLoadState('networkidle');

    // Find the item in the UI
    const itemRow = page.locator(`#item-${itemID}`);
    await expect(itemRow).toBeVisible();
    await expect(itemRow).toContainText('Test Item');
    await expect(itemRow).toContainText('pending');

    // === STEP 3: Interact with the UI to trigger backend operation ===
    // Click a button to start processing the item
    const processButton = itemRow.locator('button:has-text("Process")');
    await expect(processButton).toBeVisible();
    await processButton.click();

    // === STEP 4: Wait for loading state in UI ===
    // The UI should show a loading indicator while processing
    await expect(itemRow.locator('text=Processing...')).toBeVisible({ timeout: 2000 });

    // === STEP 5: Wait for backend operation to complete ===
    // Wait for the item to reach 'completed' status in Firestore
    // This is where async backend operations are verified
    await helpers.waitForCondition(
      '{{APP_NAME}}-items',
      itemID,
      (data) => data.status === 'completed',
      30000 // 30 second timeout
    );

    // === STEP 6: Verify UI updated to reflect completion ===
    await expect(itemRow.locator('text=Completed')).toBeVisible({ timeout: 5000 });

    // === STEP 7: Assert final state in Firestore ===
    // Verify the complete state of the item in the database
    await helpers.assertItemInFirestore('{{APP_NAME}}-items', itemID, {
      status: 'completed',
      name: 'Test Item',
    });

    // === STEP 8: Verify related data was created ===
    // If processing created other documents, query for them
    const relatedItems = await helpers.queryCollection('{{APP_NAME}}-results', {
      itemID: itemID,
    });

    expect(relatedItems.length).toBeGreaterThan(0);
    expect(relatedItems[0].status).toBe('success');
  });

  test('should handle file upload to GCS', async ({ page, helpers }) => {
    // === Example of testing file uploads to GCS ===

    // Create an item that will have a file uploaded
    const itemID = await helpers.createItem('{{APP_NAME}}-items', {
      name: 'Item with File',
      status: 'pending',
      fileStatus: 'not_uploaded',
    });

    await page.goto(`http://localhost:8080/items/${itemID}`);
    await page.waitForLoadState('networkidle');

    // Click upload button
    const uploadButton = page.locator('button:has-text("Upload")');
    await uploadButton.click();

    // Wait for upload to complete in Firestore
    await helpers.waitForCondition(
      '{{APP_NAME}}-items',
      itemID,
      (data) => data.fileStatus === 'uploaded',
      30000
    );

    // Get the item data to find the GCS path
    const itemData = await helpers.getItem('{{APP_NAME}}-items', itemID);
    expect(itemData).toBeDefined();
    expect(itemData!.gcsPath).toBeDefined();

    // Verify the file exists in GCS
    await helpers.assertFileInGCS('test-bucket', itemData!.gcsPath);

    // Optionally download and verify file content
    const fileContent = await helpers.getFileFromGCS('test-bucket', itemData!.gcsPath);
    expect(fileContent.length).toBeGreaterThan(0);
  });

  test('should handle real-time updates via SSE', async ({ page, helpers }) => {
    // === Example of testing Server-Sent Events (SSE) ===

    const itemID = await helpers.createItem('{{APP_NAME}}-items', {
      name: 'SSE Test Item',
      status: 'pending',
    });

    // Navigate to a page with SSE connection
    await page.goto(`http://localhost:8080/items/${itemID}`);
    await page.waitForLoadState('networkidle');

    // Get the element that will be updated via SSE
    const statusElement = page.locator('#item-status');
    await expect(statusElement).toContainText('pending');

    // Trigger a backend operation that will send SSE updates
    // (In this example, the backend watches Firestore and sends SSE when it changes)
    const firestore = helpers.getFirestore();
    await firestore.collection('{{APP_NAME}}-items').doc(itemID).update({
      status: 'processing',
    });

    // Wait for the SSE update to arrive and update the UI
    await expect(statusElement).toContainText('processing', { timeout: 5000 });

    // Update again
    await firestore.collection('{{APP_NAME}}-items').doc(itemID).update({
      status: 'completed',
    });

    // Verify UI updated via SSE
    await expect(statusElement).toContainText('completed', { timeout: 5000 });
  });

  test('should clean up test data automatically', async ({ helpers }) => {
    // === This test demonstrates automatic cleanup ===

    // Create multiple items
    const item1 = await helpers.createItem('{{APP_NAME}}-items', { name: 'Item 1' });
    const item2 = await helpers.createItem('{{APP_NAME}}-items', { name: 'Item 2' });
    const item3 = await helpers.createItem('{{APP_NAME}}-items', { name: 'Item 3' });

    // Verify they exist
    const items = await helpers.queryCollection('{{APP_NAME}}-items', {});
    expect(items.length).toBeGreaterThanOrEqual(3);

    // After this test completes, the helpers fixture will automatically
    // call cleanup() and delete all created items
    // No manual cleanup needed!
  });
});

/**
 * Testing Tips:
 *
 * 1. Always use waitForCondition() when testing async backend operations
 *    - Don't rely on fixed timeouts (e.g., setTimeout)
 *    - Poll Firestore until the expected state is reached
 *
 * 2. Verify state in both UI and backend
 *    - Check that UI shows correct status
 *    - Assert Firestore has correct data
 *    - Verify files exist in GCS if applicable
 *
 * 3. Use fixtures for common test scenarios
 *    - Create reusable fixtures in {{APP_NAME}}-fixtures.ts
 *    - Examples: testUser, testProject, testSession
 *
 * 4. Test real-time features properly
 *    - For SSE: Update Firestore and wait for UI to reflect changes
 *    - Use generous timeouts (5-10 seconds) for SSE updates
 *
 * 5. Trust automatic cleanup
 *    - Don't manually delete test data in tests
 *    - The helpers fixture handles cleanup automatically
 *    - This ensures cleanup happens even if tests fail
 *
 * 6. Run with emulators
 *    - Always run these tests with Firebase emulators running
 *    - Use: make test-emulator (in site directory)
 *    - Or start emulators separately: firebase emulators:start
 */
