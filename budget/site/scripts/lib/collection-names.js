import { getCollectionNameFromConfig } from './collection-name-core.js';

/**
 * Get the Firestore collection names for budget demo data based on environment
 *
 * Test environment with parallel workers: "{collection}-worker-{workerIndex}"
 * Production (main branch): "{collection}"
 * PR Preview: "{collection}_pr_{pr_number}"
 * Feature branch preview: "{collection}_preview_{sanitized_branch}"
 */

function getBaseCollectionName(baseCollectionName) {
  // Test environment: Use worker-scoped collections for parallel test isolation
  // Playwright sets PLAYWRIGHT_WORKER_INDEX (0-based) for each worker
  // Check both TEST_PARALLEL_INDEX (custom) and PLAYWRIGHT_WORKER_INDEX (Playwright built-in)
  const workerIndex = process.env.TEST_PARALLEL_INDEX || process.env.PLAYWRIGHT_WORKER_INDEX;
  if (workerIndex !== undefined && workerIndex !== null) {
    return `${baseCollectionName}-worker-${workerIndex}`;
  }

  // In emulator environment, default to worker-0 for consistency with test fixtures
  // This ensures test helpers and frontend use the same collection
  // Check FIRESTORE_EMULATOR_HOST to detect emulator mode
  // When running with emulator, always use {collection}-worker-0 to match frontend test fixture behavior
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return `${baseCollectionName}-worker-0`;
  }

  // Use shared logic for all other environments
  return getCollectionNameFromConfig(baseCollectionName, {
    prNumber: process.env.PR_NUMBER,
    branchName: process.env.BRANCH_NAME,
  });
}

export function getTransactionsCollectionName() {
  return getBaseCollectionName('budget-demo-transactions');
}

export function getStatementsCollectionName() {
  return getBaseCollectionName('budget-demo-statements');
}

export function getAccountsCollectionName() {
  return getBaseCollectionName('budget-demo-accounts');
}

export function getInstitutionsCollectionName() {
  return getBaseCollectionName('budget-demo-institutions');
}
