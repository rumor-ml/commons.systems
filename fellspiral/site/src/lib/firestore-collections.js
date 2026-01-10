import { getCardsCollectionNameFromConfig } from '../../../scripts/lib/collection-name-core.js';

/**
 * Get the Firestore collection name for cards based on environment
 *
 * Test environment: "cards-worker-{index}" (runtime override)
 * Production (main branch): "cards"
 * PR Preview: "cards_pr_{pr_number}"
 * Feature branch preview: "cards_preview_{sanitized_branch}"
 */
export function getCardsCollectionName() {
  // Check for runtime test collection override (set by test fixtures for parallel worker isolation)
  if (typeof window !== 'undefined' && window.__TEST_COLLECTION_NAME__) {
    return window.__TEST_COLLECTION_NAME__;
  }

  // Use shared logic for all other environments
  return getCardsCollectionNameFromConfig({
    prNumber: import.meta.env?.VITE_PR_NUMBER,
    branchName: import.meta.env?.VITE_BRANCH_NAME,
  });
}
