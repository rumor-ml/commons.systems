/**
 * Get the Firestore collection name for cards based on environment
 *
 * Test environment with parallel workers: "cards-worker-{workerId}"
 * Production (main branch): "cards"
 * PR Preview: "cards_pr_{pr_number}"
 * Feature branch preview: "cards_preview_{sanitized_branch}"
 */
export function getCardsCollectionName() {
  // Test environment: Use worker-scoped collections for parallel test isolation
  // TEST_PARALLEL_INDEX is set by Playwright when running with multiple workers
  const workerIndex = process.env.TEST_PARALLEL_INDEX;
  if (workerIndex !== undefined && workerIndex !== null) {
    return `cards-worker-${workerIndex}`;
  }

  // Check for PR number (from environment variable)
  const prNumber = process.env.PR_NUMBER;
  if (prNumber) {
    return `cards_pr_${prNumber}`;
  }

  // Check for branch name (from environment variable)
  const branchName = process.env.BRANCH_NAME;
  if (branchName && branchName !== 'main') {
    // Sanitize branch name: lowercase, alphanumeric + hyphens, max 63 chars
    const sanitized = branchName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    return `cards_preview_${sanitized}`;
  }

  // Production: use default collection name
  return 'cards';
}
