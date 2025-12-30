/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError } from './errors.js';
import { getGitRoot } from './git.js';
import { logger } from './logger.js';
import {
  ghCliWithRetry as sharedGhCliWithRetry,
  sleep as sharedSleep,
  type GhCliWithRetryOptions,
} from '@commons/mcp-common/gh-retry';

export interface GhCliOptions {
  repo?: string;
  timeout?: number;
  cwd?: string;
}

/**
 * Execute a GitHub CLI command safely with proper error handling
 *
 * Runs gh CLI commands with automatic working directory resolution,
 * optional repository specification, timeout support, and comprehensive
 * error handling. Includes command context in error messages for easier debugging.
 *
 * @param args - GitHub CLI command arguments (e.g., ['pr', 'view', '123'])
 * @param options - Optional execution options (repo, cwd, timeout)
 * @returns The stdout from the gh command
 * @throws {GitHubCliError} When gh command fails or exits with non-zero code
 *
 * @example
 * ```typescript
 * const prData = await ghCli(['pr', 'view', '123', '--json', 'title']);
 * const repo = await ghCli(['repo', 'view', '--json', 'nameWithOwner']);
 * ```
 */
export async function ghCli(args: string[], options: GhCliOptions = {}): Promise<string> {
  try {
    const cwd = options.cwd || (await getGitRoot());
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
      cwd: cwd,
    };

    const fullArgs = options.repo ? ['--repo', options.repo, ...args] : args;

    const result = await execa('gh', fullArgs, execaOptions);

    if (result.exitCode !== 0) {
      throw new GitHubCliError(
        `GitHub CLI command failed (gh ${fullArgs.join(' ')}): ${result.stderr || result.stdout}`,
        result.exitCode,
        result.stderr || undefined
      );
    }

    return result.stdout || '';
  } catch (error) {
    // TODO: See issue #443 - Distinguish programming errors from operational errors
    // TODO(#999): Review error propagation to ensure original error context is preserved
    if (error instanceof GitHubCliError) {
      throw error;
    }

    // Extract exitCode, stderr, stdout from execa errors before wrapping
    // This preserves critical metadata for retry logic and debugging
    const originalError = error instanceof Error ? error : new Error(String(error));
    let exitCode: number | undefined;
    let stderr: string | undefined;
    let stdout: string | undefined;

    // Check if this is an execa error with these properties
    if (error && typeof error === 'object') {
      if ('exitCode' in error && typeof (error as Record<string, unknown>).exitCode === 'number') {
        exitCode = (error as Record<string, unknown>).exitCode as number;
      }
      if ('stderr' in error && typeof (error as Record<string, unknown>).stderr === 'string') {
        stderr = (error as Record<string, unknown>).stderr as string;
      }
      if ('stdout' in error && typeof (error as Record<string, unknown>).stdout === 'string') {
        stdout = (error as Record<string, unknown>).stdout as string;
      }
    }

    throw new GitHubCliError(
      `Failed to execute gh CLI command (gh ${args.join(' ')}): ${originalError.message}`,
      exitCode,
      stderr,
      stdout,
      originalError
    );
  }
}

/**
 * Execute a GitHub CLI command and parse JSON output
 *
 * Convenience wrapper around ghCli that automatically parses JSON responses.
 *
 * @param args - GitHub CLI command arguments
 * @param options - Optional execution options
 * @returns Parsed JSON response
 * @throws {GitHubCliError} When gh command fails or JSON parsing fails
 *
 * @example
 * ```typescript
 * interface PR { number: number; title: string; }
 * const pr = await ghCliJson<PR>(['pr', 'view', '--json', 'number,title']);
 * ```
 */
export async function ghCliJson<T>(args: string[], options: GhCliOptions = {}): Promise<T> {
  const output = await ghCli(args, options);

  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new GitHubCliError(
      `Failed to parse JSON response from gh CLI: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get the current repository in format "owner/repo"
 *
 * Queries GitHub CLI for the current repository. Must be run from
 * within a git repository directory. Includes original error details
 * in error messages for better debugging.
 *
 * @returns Repository in "owner/repo" format (e.g., "github/gh")
 * @throws {GitHubCliError} When not in a repository or gh command fails
 *
 * @example
 * ```typescript
 * const repo = await getCurrentRepo();
 * console.log(repo); // "owner/repo-name"
 * ```
 */
export async function getCurrentRepo(): Promise<string> {
  try {
    const result = await ghCli(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    return result.trim();
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    throw new GitHubCliError(
      `Failed to get current repository. Make sure you're in a git repository or provide the --repo flag. Original error: ${originalMessage}`,
      error instanceof GitHubCliError ? error.exitCode : undefined,
      error instanceof GitHubCliError ? error.stderr : undefined,
      undefined,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Resolve repository - use provided repo or get current repo
 *
 * Helper function that returns the provided repository or automatically
 * detects the current repository if none is provided.
 *
 * @param repo - Optional repository in "owner/repo" format
 * @returns Resolved repository in "owner/repo" format
 * @throws {GitHubCliError} When repo is not provided and current repo detection fails
 *
 * @example
 * ```typescript
 * const repo = await resolveRepo("owner/repo"); // Returns "owner/repo"
 * const currentRepo = await resolveRepo(); // Auto-detects from git directory
 * ```
 */
export async function resolveRepo(repo?: string): Promise<string> {
  if (repo) {
    return repo;
  }
  return getCurrentRepo();
}

/**
 * GitHub PR response type from gh pr view --json
 */
export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  mergeable: string;
  mergeStateStatus: string;
  labels?: Array<{ name: string }>;
}

/**
 * Get PR details
 *
 * Fetches pull request information from GitHub using gh CLI.
 * If prNumber is omitted or undefined, gets PR for current branch.
 *
 * @param prNumber - Optional PR number to fetch. If omitted, fetches PR for current branch.
 * @param repo - Optional repository in "owner/repo" format
 * @returns PR details including number, title, labels, head/base refs, etc.
 * @throws {GitHubCliError} When PR doesn't exist or gh command fails
 *
 * @example
 * ```typescript
 * const pr = await getPR(123, "owner/repo");
 * const currentBranchPR = await getPR(); // Gets PR for current branch
 * ```
 */
export async function getPR(prNumber?: number, repo?: string): Promise<GitHubPR> {
  const args = [
    'pr',
    'view',
    ...(prNumber ? [prNumber.toString()] : []), // Omit number to get current branch PR
    '--json',
    'number,title,state,url,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,labels',
  ];

  // Only use --repo flag when we have a PR number
  // gh pr view without args (current branch) doesn't work with --repo flag
  const options = prNumber && repo ? { repo: await resolveRepo(repo) } : {};

  return ghCliJson<GitHubPR>(args, options);
}

/**
 * GitHub PR comment type
 */
export interface GitHubPRComment {
  author: string;
  body: string;
  createdAt: string;
  id: string;
}

/**
 * Get all comments for a PR
 *
 * Fetches all comments on a pull request using gh CLI.
 * Returns simplified comment objects with author, body, timestamp, and ID.
 *
 * @param prNumber - PR number to fetch comments for
 * @param repo - Optional repository in "owner/repo" format
 * @returns Array of PR comments with author, body, createdAt, and id
 * @throws {GitHubCliError} When PR doesn't exist or gh command fails
 *
 * @example
 * ```typescript
 * const comments = await getPRComments(123, "owner/repo");
 * for (const comment of comments) {
 *   console.log(`${comment.author}: ${comment.body}`);
 * }
 * ```
 */
export async function getPRComments(prNumber: number, repo?: string): Promise<GitHubPRComment[]> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson<GitHubPRComment[]>(
    [
      'pr',
      'view',
      prNumber.toString(),
      '--json',
      'comments',
      '-q',
      '.comments | map({author: .author.login, body: .body, createdAt: .createdAt, id: .id})',
    ],
    { repo: resolvedRepo }
  );
}

/**
 * Post a comment to a PR
 *
 * Posts a new comment on a pull request using gh CLI.
 *
 * @param prNumber - PR number to comment on
 * @param body - Comment body (markdown supported)
 * @param repo - Optional repository in "owner/repo" format
 * @throws {GitHubCliError} When PR doesn't exist or gh command fails
 *
 * @example
 * ```typescript
 * await postPRComment(123, "LGTM! Approved.", "owner/repo");
 * ```
 */
export async function postPRComment(prNumber: number, body: string, repo?: string): Promise<void> {
  const resolvedRepo = await resolveRepo(repo);
  await ghCli(['pr', 'comment', prNumber.toString(), '--body', body], { repo: resolvedRepo });
}

/**
 * GitHub PR review comment type (from API)
 * Note: This is a subset of the full API response - includes common fields
 */
export interface GitHubPRReviewComment {
  readonly id: number;
  readonly user: {
    readonly login: string;
  };
  readonly body: string;
  readonly path: string;
  readonly position?: number;
  readonly line?: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly [key: string]: unknown; // Allow additional fields from GitHub API
}

/**
 * Result from getPRReviewComments including parsed comments and completeness info
 *
 * Data completeness is tracked explicitly to help callers warn users when
 * review data is incomplete due to parsing failures.
 */
export interface PRReviewCommentsResult {
  /** Successfully parsed review comments */
  readonly comments: readonly GitHubPRReviewComment[];
  /** Number of comments that failed to parse and were skipped */
  readonly skippedCount: number;
  /** Whether all comments were parsed successfully (skippedCount === 0) */
  readonly isComplete: boolean;
  /** User-facing warning when skippedCount > 0, describing data incompleteness */
  readonly warning?: string;
}

/**
 * Get PR review comments from specific user
 *
 * Fetches inline code review comments (not PR comments) from a specific user
 * using GitHub API via gh CLI. These are comments on specific lines of code.
 *
 * Returns both the parsed comments and a count of any comments that failed to parse.
 * Callers should check skippedCount and warn users if review data is incomplete.
 *
 * @param prNumber - PR number to fetch review comments for
 * @param username - GitHub username to filter comments by
 * @param repo - Optional repository in "owner/repo" format
 * @returns Object with parsed comments array and count of skipped malformed comments
 * @throws {GitHubCliError} When API call fails or JSON parsing fails
 *
 * @example
 * ```typescript
 * const { comments, skippedCount } = await getPRReviewComments(123, "github-code-quality[bot]");
 * if (skippedCount > 0) {
 *   console.warn(`${skippedCount} comments could not be parsed - review data may be incomplete`);
 * }
 * console.log(`Found ${comments.length} code review comments`);
 * ```
 */
export async function getPRReviewComments(
  prNumber: number,
  username: string,
  repo?: string
): Promise<PRReviewCommentsResult> {
  const resolvedRepo = await resolveRepo(repo);
  // Escape username for safe use in jq filter string context
  const escapedUsername = username.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const result = await ghCli(
    [
      'api',
      `repos/${resolvedRepo}/pulls/${prNumber}/comments`,
      '--jq',
      `.[] | select(.user.login == "${escapedUsername}")`,
    ],
    {}
  );

  if (!result.trim()) {
    return { comments: [], skippedCount: 0, isComplete: true };
  }

  // Split by newlines and parse each JSON object
  const lines = result
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const comments: GitHubPRReviewComment[] = [];
  let skippedCount = 0;

  // Design decision: Continue processing when individual comments are malformed
  // Rationale: Single malformed JSON should not block processing of all remaining valid comments
  // Historical context: Production incidents showed one bad comment blocking entire review pipeline
  // Solution: Skip malformed comments with warning logging to prevent total failure
  for (const line of lines) {
    try {
      comments.push(JSON.parse(line));
    } catch (error) {
      skippedCount++;
      // WARN level - individual parse failures are expected edge cases, not errors
      // Include stack trace for debugging JSON parsing failures (may indicate API format changes)
      // TODO(#982): Add DEBUG-level log with full raw line content for post-mortem analysis
      logger.warn('Failed to parse review comment JSON - comment will be skipped', {
        prNumber,
        username,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        linePreview: line.substring(0, 100),
        position: comments.length,
        totalSkipped: skippedCount,
        impact: 'Review data incomplete - some comments could not be parsed',
      });
    }
  }

  // Build warning and log summary if any comments were skipped
  let warning: string | undefined;
  const totalAttempted = comments.length + skippedCount;

  if (skippedCount > 0) {
    const skipPercentage = ((skippedCount / totalAttempted) * 100).toFixed(1);
    const skipRatio = skippedCount / totalAttempted;

    // Throw if too much data lost (>10% of comments unparseable)
    // This indicates a GitHub API issue, gh CLI version incompatibility, or severe corruption
    // that makes the review data too unreliable to use
    // Note: Lower threshold (10% vs 20%) because code review data is critical for quality gates
    if (skipRatio > 0.1) {
      logger.error('Too many malformed review comments - data unreliable', {
        prNumber,
        username,
        parsedCount: comments.length,
        skippedCount,
        skipPercentage: `${skipPercentage}%`,
        threshold: '10%',
        impact: 'Review data too incomplete to proceed safely',
        action: 'Check GitHub API and gh CLI version compatibility',
      });

      throw new GitHubCliError(
        `Too many malformed review comments (${skippedCount}/${totalAttempted}, ${skipPercentage}%). ` +
          `This indicates a GitHub API issue or gh CLI version incompatibility. ` +
          `Review data is too incomplete to proceed safely. ` +
          `Check the comments on GitHub's web UI to see all feedback.`
      );
    }

    warning =
      `Warning: ${skippedCount} of ${totalAttempted} review comments (${skipPercentage}%) ` +
      `could not be parsed and were skipped. Review data may be incomplete. ` +
      `Check the comments on GitHub's web UI to see all feedback.`;

    logger.error('Some review comments could not be parsed', {
      prNumber,
      username,
      parsedCount: comments.length,
      skippedCount,
      skipPercentage: `${skipPercentage}%`,
      userGuidance: warning,
      action: 'Display warning to user and suggest checking GitHub web UI',
    });
  }

  return {
    comments,
    skippedCount,
    isComplete: skippedCount === 0,
    warning,
  };
}

/**
 * Sleep for a specified number of milliseconds
 *
 * Re-exports from mcp-common for backward compatibility.
 */
export const sleep = sharedSleep;

/**
 * Execute gh CLI command with retry logic
 *
 * Retries gh CLI commands for transient errors (network issues, timeouts, 5xx errors, rate limits).
 * Uses exponential backoff (2s, 4s, 8s). Logs retry attempts and final failures.
 * Non-retryable errors (like validation errors) fail immediately.
 *
 * This is a wrapper around the shared ghCliWithRetry from mcp-common,
 * injecting the local ghCli function.
 *
 * @param args - GitHub CLI command arguments
 * @param options - Optional execution options
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns The stdout from the gh command
 * @throws {Error} When all retry attempts are exhausted or error is non-retryable
 *
 * @example
 * ```typescript
 * // Retry network-sensitive operations
 * const data = await ghCliWithRetry(['pr', 'view', '123'], {}, 5);
 * ```
 */
export async function ghCliWithRetry(
  args: string[],
  options?: GhCliOptions,
  maxRetries = 3
): Promise<string> {
  return sharedGhCliWithRetry(ghCli, args, options as GhCliWithRetryOptions, maxRetries);
}
