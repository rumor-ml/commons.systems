import { getCollectionNameFromConfig } from './collection-name-core.js';

/**
 * Get the Firestore collection names for budget demo data based on environment
 *
 * Emulator environment: "{collection}-worker-0" (always, for seed/test consistency)
 * Test environment with parallel workers: "{collection}-worker-{workerIndex}"
 * Production (main branch): "{collection}"
 * PR Preview: "{collection}_pr_{pr_number}"
 * Feature branch preview: "{collection}_preview_{sanitized_branch}"
 */

function getBaseCollectionName(baseCollectionName) {
  // In emulator environment, always use worker-0 for consistency between seeding and testing
  // This ensures seed-local.sh and Playwright tests use the same collection
  // Check FIRESTORE_EMULATOR_HOST to detect emulator mode
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return `${baseCollectionName}-worker-0`;
  }

  // Test environment with parallel workers: "{collection}-worker-{workerIndex}"
  // Only apply worker isolation when NOT in emulator mode (e.g., when running against deployed Firestore)
  const workerIndex = process.env.TEST_PARALLEL_INDEX || process.env.PLAYWRIGHT_WORKER_INDEX;
  if (workerIndex !== undefined && workerIndex !== null) {
    return `${baseCollectionName}-worker-${workerIndex}`;
  }

  // Production/PR previews: Use PR number or branch name for namespacing
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
