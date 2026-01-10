import { getCardsCollectionNameFromConfig } from '../../../scripts/lib/collection-name-core.js';

/**
 * Get the Firestore collection name for cards based on environment
 *
 * Priority order:
 * 1. URL parameter "testCollection" (for E2E tests - available immediately, no race condition)
 * 2. Window global __TEST_COLLECTION_NAME__ (legacy, for backwards compatibility)
 * 3. Vite environment variables (PR previews, production)
 *
 * Test environment: "cards-worker-{index}" (runtime override)
 * Production (main branch): "cards"
 * PR Preview: "cards_pr_{pr_number}"
 * Feature branch preview: "cards_preview_{sanitized_branch}"
 */
export function getCardsCollectionName() {
  // Priority 1: URL parameter (for E2E tests - available immediately when JS runs)
  // This eliminates race conditions where getAllCards() runs before addInitScript sets window global
  if (typeof window !== 'undefined' && window.location?.search) {
    const urlParams = new URLSearchParams(window.location.search);
    const urlCollection = urlParams.get('testCollection');
    if (urlCollection) {
      return urlCollection;
    }
  }

  // Priority 2: Window global (legacy, for backwards compatibility with existing tests)
  if (typeof window !== 'undefined' && window.__TEST_COLLECTION_NAME__) {
    return window.__TEST_COLLECTION_NAME__;
  }

  // Priority 3: Vite environment variables (PR previews, production)
  return getCardsCollectionNameFromConfig({
    prNumber: import.meta.env?.VITE_PR_NUMBER,
    branchName: import.meta.env?.VITE_BRANCH_NAME,
  });
}
