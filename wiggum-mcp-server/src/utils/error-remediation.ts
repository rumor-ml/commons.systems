/**
 * Error classification and remediation utilities for GitHub API errors.
 *
 * Provides specific, actionable guidance for different types of GitHub CLI/API failures.
 */

export type GitHubErrorType =
  | 'permission'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'not_found'
  | 'unknown';

export interface ErrorClassification {
  /** The classified error type */
  type: GitHubErrorType;
  /** Whether this error is likely transient and retryable */
  isRetryable: boolean;
  /** Specific remediation steps for this error type */
  remediationSteps: string[];
}

/**
 * Classify a GitHub CLI/API error based on error message and exit code.
 *
 * @param errorMsg - Error message from GitHub CLI
 * @param exitCode - Exit code from GitHub CLI (optional)
 * @returns Error classification with remediation guidance
 *
 * @example
 * classifyGitHubError("GraphQL: Forbidden (HTTP 403)", 1)
 * // Returns: { type: 'permission', isRetryable: false, remediationSteps: [...] }
 */
export function classifyGitHubError(errorMsg: string, exitCode?: number): ErrorClassification {
  const lowerMsg = errorMsg.toLowerCase();

  // Permission errors
  if (
    lowerMsg.includes('forbidden') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('http 403') ||
    lowerMsg.includes('http 401') ||
    exitCode === 4 // gh CLI uses exit code 4 for auth errors
  ) {
    return {
      type: 'permission',
      isRetryable: false,
      remediationSteps: [
        'Check authentication status: gh auth status',
        'Verify token has required scopes (repo, read:org)',
        'Re-authenticate if needed: gh auth refresh -h github.com -s repo,read:org',
        'Confirm you have access to this repository',
      ],
    };
  }

  // Rate limit errors
  if (
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('http 429') ||
    lowerMsg.includes('api rate limit exceeded')
  ) {
    return {
      type: 'rate_limit',
      isRetryable: true,
      remediationSteps: [
        'Check rate limit status: gh api rate_limit',
        'Wait for rate limit reset (shown in rate_limit response)',
        'Consider using authenticated requests for higher limits',
        'Reduce request frequency if this is recurring',
      ],
    };
  }

  // Timeout errors
  if (
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('deadline exceeded')
  ) {
    return {
      type: 'timeout',
      isRetryable: true,
      remediationSteps: [
        'Check network latency to GitHub',
        'Retry the operation (may be transient)',
        'Check GitHub status: https://www.githubstatus.com',
        'Consider increasing timeout if this is a large operation',
      ],
    };
  }

  // Network errors
  if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('connection') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enotfound') ||
    lowerMsg.includes('getaddrinfo') ||
    lowerMsg.includes('could not resolve host')
  ) {
    return {
      type: 'network',
      isRetryable: true,
      remediationSteps: [
        'Check internet connectivity',
        'Verify DNS resolution: nslookup github.com',
        'Check GitHub status: https://www.githubstatus.com',
        'Retry the operation (may be transient)',
        'Check firewall/proxy settings if applicable',
      ],
    };
  }

  // Not found errors
  if (
    lowerMsg.includes('not found') ||
    lowerMsg.includes('http 404') ||
    lowerMsg.includes('no such') ||
    lowerMsg.includes('could not resolve to')
  ) {
    return {
      type: 'not_found',
      isRetryable: false,
      remediationSteps: [
        'Verify the resource exists (PR number, issue number, repository)',
        'Check for typos in repository name or resource ID',
        'Confirm you have access to view this resource',
        'Resource may have been deleted or moved',
      ],
    };
  }

  // Unknown error
  return {
    type: 'unknown',
    isRetryable: false,
    remediationSteps: [
      'Review the full error message for specific details',
      'Check GitHub CLI version: gh --version',
      'Try running the command manually to reproduce',
      'Check GitHub status: https://www.githubstatus.com',
      'Report if this appears to be a bug in the MCP server',
    ],
  };
}

/**
 * Build a comprehensive error message for GitHub API operations.
 *
 * @param operation - Description of the operation that failed (e.g., "create PR", "post comment")
 * @param errorMsg - Error message from GitHub CLI
 * @param exitCode - Exit code from GitHub CLI (optional)
 * @param additionalContext - Additional context to include in the message (optional)
 * @returns Formatted error message with classification and remediation
 *
 * @example
 * buildGitHubErrorMessage(
 *   "post state comment to PR #123",
 *   "GraphQL: Forbidden (HTTP 403)",
 *   1,
 *   { prNumber: 123, impact: "State tracking will be incomplete" }
 * )
 *
 * // Returns multi-line error message:
 * // GitHub operation failed: post state comment to PR #123
 * //
 * // Error type: permission
 * // Error message: GraphQL: Forbidden (HTTP 403)
 * // Exit code: 1
 * //
 * // Additional context:
 * // - prNumber: 123
 * // - impact: State tracking will be incomplete
 * //
 * // How to fix:
 * // 1. Check authentication status: gh auth status
 * // 2. Verify token has required scopes (repo, read:org)
 * // ...
 */
export function buildGitHubErrorMessage(
  operation: string,
  errorMsg: string,
  exitCode?: number,
  additionalContext?: Record<string, unknown>
): string {
  const classification = classifyGitHubError(errorMsg, exitCode);
  const lines: string[] = [];

  // Operation header
  lines.push(`GitHub operation failed: ${operation}`);
  lines.push('');

  // Error details
  lines.push(`Error type: ${classification.type}`);
  lines.push(`Error message: ${errorMsg}`);
  if (exitCode !== undefined) {
    lines.push(`Exit code: ${exitCode}`);
  }

  // Additional context
  if (additionalContext && Object.keys(additionalContext).length > 0) {
    lines.push('');
    lines.push('Additional context:');
    for (const [key, value] of Object.entries(additionalContext)) {
      lines.push(`- ${key}: ${JSON.stringify(value)}`);
    }
  }

  // Remediation steps
  lines.push('');
  lines.push('How to fix:');
  classification.remediationSteps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step}`);
  });

  // Retryable note
  if (classification.isRetryable) {
    lines.push('');
    lines.push('Note: This error is likely transient. The operation may succeed if retried.');
  }

  return lines.join('\n');
}
