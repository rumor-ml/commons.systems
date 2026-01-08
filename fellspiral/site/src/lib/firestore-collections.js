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

  // Check for PR number (injected at build time)
  const prNumber = import.meta.env?.VITE_PR_NUMBER;
  if (prNumber) {
    return `cards_pr_${prNumber}`;
  }

  // Check for branch name (injected at build time)
  const branchName = import.meta.env?.VITE_BRANCH_NAME;
  if (branchName && branchName !== 'main') {
    // Sanitize branch name: lowercase, alphanumeric + hyphens, max 63 chars
    const sanitized = branchName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50); // Leave room for prefix

    return `cards_preview_${sanitized}`;
  }

  // Production: use default collection name
  return 'cards';
}
