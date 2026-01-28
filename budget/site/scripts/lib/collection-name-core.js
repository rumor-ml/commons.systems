/**
 * Shared logic for determining Firestore collection names for budget demo data
 * Used by both Node.js (server-side) and browser (client-side) environments
 *
 * @param {Object} config - Configuration object
 * @param {string} baseCollectionName - Base collection name (e.g., 'budget-demo-transactions')
 * @param {string|undefined} config.prNumber - PR number (undefined if not in PR environment)
 * @param {string|undefined} config.branchName - Branch name (undefined if not in branch environment)
 * @returns {string} Collection name based on environment
 */
export function getCollectionNameFromConfig(baseCollectionName, config) {
  const { prNumber, branchName } = config;

  // Check for PR number
  if (prNumber) {
    return `${baseCollectionName}_pr_${prNumber}`;
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

    return `${baseCollectionName}_preview_${sanitized}`;
  }

  // Production: use default collection name
  return baseCollectionName;
}
