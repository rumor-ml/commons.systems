/**
 * Authenticated Test Fixtures
 *
 * Provides fixtures for tests that require authentication.
 */

import { test as base } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const authFile = path.join(__dirname, '../../.auth/user.json');

// Check if auth state exists
const hasAuthState = fs.existsSync(authFile);

/**
 * Authenticated test fixture
 * Uses saved auth state from global setup
 */
export const test = base.extend({
  // Use authenticated storage state if available
  storageState: async ({}, use) => {
    if (hasAuthState) {
      await use(authFile);
    } else {
      await use(undefined);
    }
  },
});

export { expect } from '@playwright/test';

/**
 * Helper to check if tests should run
 * @returns {boolean} True if auth state is available
 */
export function hasAuth() {
  return hasAuthState;
}

/**
 * Skip test if no auth state
 */
export function requiresAuth() {
  if (!hasAuthState) {
    test.skip(true, 'Skipping test - no auth state available. Run with GITHUB_TEST_USER and GITHUB_TEST_PASSWORD to enable.');
  }
}
