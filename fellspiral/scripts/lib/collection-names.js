import { getCardsCollectionNameFromConfig } from './collection-name-core.js';

/**
 * Get the Firestore collection name for cards based on environment
 *
 * Test environment with parallel workers: "cards-worker-{workerIndex}"
 * Production (main branch): "cards"
 * PR Preview: "cards_pr_{pr_number}"
 * Feature branch preview: "cards_preview_{sanitized_branch}"
 */
export function getCardsCollectionName() {
  // Test environment: Use worker-scoped collections for parallel test isolation
  // Playwright sets PLAYWRIGHT_WORKER_INDEX (0-based) for each worker
  // Check both TEST_PARALLEL_INDEX (custom) and PLAYWRIGHT_WORKER_INDEX (Playwright built-in)
  const workerIndex = process.env.TEST_PARALLEL_INDEX || process.env.PLAYWRIGHT_WORKER_INDEX;
  if (workerIndex !== undefined && workerIndex !== null) {
    return `cards-worker-${workerIndex}`;
  }

  // In emulator environment, default to worker-0 for consistency with test fixtures
  // This ensures test helpers and frontend use the same collection
  // Check FIRESTORE_EMULATOR_HOST to detect emulator mode
  // When running with emulator, always use cards-worker-0 to match frontend test fixture behavior
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return 'cards-worker-0';
  }

  // Use shared logic for all other environments
  return getCardsCollectionNameFromConfig({
    prNumber: process.env.PR_NUMBER,
    branchName: process.env.BRANCH_NAME,
  });
}
