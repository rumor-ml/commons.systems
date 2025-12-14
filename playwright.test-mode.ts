// playwright.test-mode.ts
// Exported test utilities for environment-aware testing

export const isDeployed = process.env.DEPLOYED === 'true';
export const isEmulator = !isDeployed;
export const deployedUrl = process.env.DEPLOYED_URL;
export const prNumber = process.env.PR_NUMBER;
export const branchName = process.env.BRANCH_NAME || 'main';

// Helper to skip tests based on environment
export function skipInDeployed(test: typeof import('@playwright/test').test, reason?: string) {
  test.skip(isDeployed, reason || 'This test requires Firebase emulators');
}

export function skipInEmulator(test: typeof import('@playwright/test').test, reason?: string) {
  test.skip(isEmulator, reason || 'This test requires deployed environment');
}

// Get the collection namespace for the current environment
export function getTestCollectionNamespace(): string {
  if (prNumber) return `pr_${prNumber}`;
  if (branchName && branchName !== 'main') {
    const sanitized = branchName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .substring(0, 50);
    return `preview_${sanitized}`;
  }
  return 'production';
}
