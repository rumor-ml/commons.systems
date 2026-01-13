/**
 * Shared logic for determining the Firestore collection name for cards
 * Used by both Node.js (server-side) and browser (client-side) environments
 *
 * @param {Object} config - Configuration object
 * @param {string|undefined} config.prNumber - PR number (undefined if not in PR environment)
 * @param {string|undefined} config.branchName - Branch name (undefined if not in branch environment)
 * @returns {string} Collection name based on environment
 */
export function getCardsCollectionNameFromConfig(config) {
  const { prNumber, branchName } = config;

  // Check for PR number
  if (prNumber) {
    return `cards_pr_${prNumber}`;
  }

  // Check for branch name
  if (branchName && branchName !== 'main') {
    // Sanitize branch name: lowercase, alphanumeric + hyphens, max 50 chars
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
