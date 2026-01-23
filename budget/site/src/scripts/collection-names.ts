/**
 * Collection name helpers for budget demo data
 * Supports environment-specific namespacing for PR previews
 */

/**
 * Shared logic for determining Firestore collection names for budget demo data
 * Used by the browser (client-side) environment
 *
 * @param baseCollectionName - Base collection name (e.g., 'budget-demo-transactions')
 * @param config - Configuration object with prNumber and branchName
 * @returns Collection name based on environment
 */
function getCollectionNameFromConfig(
  baseCollectionName: string,
  config: { prNumber?: string; branchName?: string }
): string {
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

/**
 * Get environment configuration from Vite environment variables
 * In production, these are set at build time by the deployment script
 */
function getEnvironmentConfig(): { prNumber?: string; branchName?: string } {
  return {
    prNumber: import.meta.env.VITE_PR_NUMBER,
    branchName: import.meta.env.VITE_BRANCH_NAME,
  };
}

/**
 * Get collection names for budget demo data
 * Automatically uses environment-specific namespacing for PR previews
 */
export function getTransactionsCollectionName(): string {
  return getCollectionNameFromConfig('budget-demo-transactions', getEnvironmentConfig());
}

export function getStatementsCollectionName(): string {
  return getCollectionNameFromConfig('budget-demo-statements', getEnvironmentConfig());
}

export function getAccountsCollectionName(): string {
  return getCollectionNameFromConfig('budget-demo-accounts', getEnvironmentConfig());
}

export function getInstitutionsCollectionName(): string {
  return getCollectionNameFromConfig('budget-demo-institutions', getEnvironmentConfig());
}
