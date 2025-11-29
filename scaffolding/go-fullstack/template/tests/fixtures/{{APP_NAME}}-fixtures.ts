import { test as base, expect } from '@playwright/test';
import { TestHelpers } from './test-helpers';

/**
 * Extended Playwright fixtures for {{APP_NAME_TITLE}} E2E tests
 *
 * This file extends Playwright's base test with custom fixtures that provide:
 * - TestHelpers instance with automatic cleanup after each test
 * - Pre-seeded test data scenarios (add your own as needed)
 */
export const test = base.extend<{
  helpers: TestHelpers;
}>({
  /**
   * TestHelpers fixture - automatically creates and cleans up after each test
   *
   * Usage in tests:
   * test('my test', async ({ helpers }) => {
   *   const itemID = await helpers.createItem('items', { name: 'Test Item' });
   *   await helpers.waitForCondition('items', itemID, (data) => data.status === 'ready');
   *   await helpers.assertItemInFirestore('items', itemID, { status: 'ready' });
   * });
   */
  helpers: async ({}, use) => {
    const helpers = new TestHelpers();

    // Provide the helpers to the test
    await use(helpers);

    // Cleanup after the test completes
    await helpers.cleanup();
  },

  // Add more fixtures here as needed for your app
  // Examples:
  //
  // /**
  //  * Pre-seeded user fixture
  //  */
  // testUser: async ({ helpers }, use) => {
  //   const userID = await helpers.createItem('users', {
  //     email: 'test@example.com',
  //     name: 'Test User',
  //   });
  //
  //   await use({ userID });
  // },
  //
  // /**
  //  * Pre-seeded project with tasks
  //  */
  // testProject: async ({ helpers, testUser }, use) => {
  //   const projectID = await helpers.createItem('projects', {
  //     name: 'Test Project',
  //     ownerID: testUser.userID,
  //   });
  //
  //   const taskIDs: string[] = [];
  //   for (let i = 0; i < 3; i++) {
  //     const taskID = await helpers.createItem('tasks', {
  //       title: `Test Task ${i + 1}`,
  //       projectID,
  //       status: 'pending',
  //     });
  //     taskIDs.push(taskID);
  //   }
  //
  //   await use({ projectID, taskIDs });
  // },
});

export { expect };
