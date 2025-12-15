/**
 * Utilities for formatting GitHub PR check status information
 */

/**
 * Maps a check bucket status to a display icon
 * @param bucket - The check bucket status from GitHub API
 * @returns A Unicode character representing the status
 */
export function getCheckIcon(bucket: string): string {
  switch (bucket) {
    case 'pass':
      return '✓';
    case 'fail':
      return '✗';
    case 'pending':
      return '○';
    default:
      return '~';
  }
}

interface StatusCounts {
  successCount: number;
  failureCount: number;
  pendingCount: number;
  totalCount: number;
}

interface PRState {
  mergeable: string; // "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  mergeStateStatus: string; // "BLOCKED" | "BEHIND" | "CLEAN" | "DIRTY" | "UNSTABLE" etc.
}

/**
 * Determines the overall status of a PR based on check results and merge state
 * @param counts - Check status counts
 * @param prState - PR merge state information
 * @returns Overall status string
 */
export function determineOverallStatus(counts: StatusCounts, prState: PRState): string {
  const { successCount, failureCount, pendingCount, totalCount } = counts;

  // Check for merge conflicts first
  if (prState.mergeable === 'CONFLICTING') {
    return 'CONFLICTS';
  }

  // Check if PR is blocked or dirty
  if (prState.mergeStateStatus === 'DIRTY' || prState.mergeStateStatus === 'BLOCKED') {
    // If checks passed but PR is blocked/dirty, indicate blocking status
    if (failureCount === 0 && successCount === totalCount) {
      return 'BLOCKED';
    } else if (failureCount > 0) {
      return 'FAILED';
    } else if (pendingCount > 0) {
      return 'PENDING';
    } else {
      return 'MIXED';
    }
  }

  // Standard check-based status
  if (failureCount > 0) {
    return 'FAILED';
  } else if (pendingCount > 0) {
    return 'PENDING';
  } else if (successCount === totalCount) {
    return 'SUCCESS';
  } else {
    return 'MIXED';
  }
}
