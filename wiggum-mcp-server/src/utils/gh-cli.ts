/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError } from './errors.js';
import { getGitRoot } from './git.js';
import { logger } from './logger.js';

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

    // Add repo flag if provided
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
    if (error instanceof GitHubCliError) {
      throw error;
    }
    // Preserve original error type for better debugging, but wrap in GitHubCliError
    const originalError = error instanceof Error ? error : new Error(String(error));
    throw new GitHubCliError(
      `Failed to execute gh CLI command (gh ${args.join(' ')}): ${originalError.message}`,
      undefined,
      undefined,
      undefined,
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
  id: number;
  user: {
    login: string;
  };
  body: string;
  path: string;
  position?: number;
  line?: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown; // Allow additional fields from GitHub API
}

/**
 * Get PR review comments from specific user
 *
 * Fetches inline code review comments (not PR comments) from a specific user
 * using GitHub API via gh CLI. These are comments on specific lines of code.
 *
 * @param prNumber - PR number to fetch review comments for
 * @param username - GitHub username to filter comments by
 * @param repo - Optional repository in "owner/repo" format
 * @returns Array of review comments from the specified user
 * @throws {GitHubCliError} When API call fails or JSON parsing fails
 *
 * @example
 * ```typescript
 * const comments = await getPRReviewComments(123, "github-code-quality[bot]");
 * console.log(`Found ${comments.length} code review comments`);
 * ```
 */
export async function getPRReviewComments(
  prNumber: number,
  username: string,
  repo?: string
): Promise<GitHubPRReviewComment[]> {
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
    return [];
  }

  // Split by newlines and parse each JSON object
  const lines = result
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const comments: GitHubPRReviewComment[] = [];

  // TODO(#272): Skip malformed comments instead of throwing (see PR review #273)
  // TODO(#457, #465): Skip malformed comments, log warning, continue processing valid comments
  // Current: throws on first malformed comment, blocking all remaining valid comments
  for (const line of lines) {
    try {
      comments.push(JSON.parse(line));
      // TODO(#319): Skip malformed comments instead of throwing
      // Current: Single malformed comment blocks all subsequent valid comments
    } catch (error) {
      throw new GitHubCliError(
        `Failed to parse review comment JSON for PR ${prNumber}: ${error instanceof Error ? error.message : String(error)}. Line: ${line.substring(0, 100)}`
      );
    }
  }

  return comments;
}

/**
 * Sleep for a specified number of milliseconds
 *
 * Utility function for introducing delays, useful for retry logic and rate limiting.
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified delay
 *
 * @example
 * ```typescript
 * await sleep(1000); // Wait 1 second
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Node.js error codes that indicate retryable network/connection issues
 *
 * These are stable error codes from the Node.js error API, preferred over
 * string matching on error messages.
 */
const RETRYABLE_ERROR_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'EPIPE',
];

/**
 * Check if an error is retryable (network errors, 5xx server errors, rate limits)
 *
 * Determines if an error should be retried using a priority-based approach:
 * 1. Exit code (most reliable) - checks for known HTTP error codes
 * 2. Node.js error.code (stable API) - checks for network/connection errors
 * 3. Message pattern matching (fallback) - for when structured data is missing
 *
 * Current limitation: gh CLI wraps errors in generic Error objects, losing HTTP
 * status codes and error types. We must parse error messages, which are fragile
 * to GitHub CLI updates. See issue #453 for migration to structured error types.
 *
 * @param error - Error to check for retryability
 * @param exitCode - Optional exit code from the CLI command
 * @returns true if error should be retried, false otherwise
 *
 * @example
 * ```typescript
 * try {
 *   await ghCli(['pr', 'view']);
 * } catch (error) {
 *   if (isRetryableError(error)) {
 *     // Retry the operation
 *   }
 * }
 * ```
 */
// TODO: See issue #453 - Use error types instead of string matching for retry logic
function isRetryableError(error: unknown, exitCode?: number): boolean {
  // Priority 1: Exit code (most reliable when available)
  if (exitCode !== undefined) {
    if ([429, 502, 503, 504].includes(exitCode)) {
      return true;
    }
  }

  if (error instanceof Error) {
    // Priority 2: Node.js error codes (stable API)
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code && RETRYABLE_ERROR_CODES.includes(nodeError.code)) {
      return true;
    }

    // Priority 3: Message pattern matching (fallback, less reliable)
    // This is fragile - error messages can change with GitHub CLI versions
    const msg = error.message.toLowerCase();
    const patterns = [
      // Network errors
      'network',
      'timeout',
      'socket',
      'connection',
      'econnreset', // Fallback if error.code missing
      'econnrefused',
      // HTTP status codes (in case exitCode not provided)
      '429',
      '502',
      '503',
      '504',
      // Rate limit messages (multiple phrasings - fragile to changes)
      'rate limit',
      'api rate limit exceeded',
      'rate_limit_exceeded',
      'quota exceeded',
      'too many requests',
    ];

    return patterns.some((pattern) => msg.includes(pattern));
  }
  return false;
}

/**
 * Classify error type for logging and diagnostics
 *
 * Categorizes errors into types for pattern analysis and debugging.
 * Uses a priority-based approach:
 * 1. Exit code (most reliable when available)
 * 2. Node.js error codes (stable API)
 * 3. Message pattern matching (fallback, less reliable)
 *
 * @param error - Error to classify
 * @param exitCode - Optional exit code for more reliable classification
 * @returns Error type string (network, timeout, rate_limit, permission, not_found, server_error, unknown)
 */
function classifyErrorType(error: Error, exitCode?: number): string {
  // Priority 1: Use exit code for classification (most reliable)
  if (exitCode !== undefined) {
    if (exitCode === 429) return 'rate_limit';
    if ([502, 503, 504].includes(exitCode)) return 'server_error';
    if ([401, 403].includes(exitCode)) return 'permission';
    if (exitCode === 404) return 'not_found';
  }

  // Priority 2: Use Node.js error codes (stable API)
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code) {
    if (['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'ENOTFOUND'].includes(nodeError.code)) {
      return 'network';
    }
    if (nodeError.code === 'ETIMEDOUT') {
      return 'timeout';
    }
  }

  // Priority 3: Message pattern matching (fallback, less reliable)
  const msg = error.message.toLowerCase();

  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return 'network';
  }
  if (msg.includes('timeout') || msg.includes('etimedout')) {
    return 'timeout';
  }
  if (msg.includes('rate limit') || msg.includes('429')) {
    return 'rate_limit';
  }
  if (msg.includes('forbidden') || msg.includes('401') || msg.includes('403')) {
    return 'permission';
  }
  if (msg.includes('404') || msg.includes('not found')) {
    return 'not_found';
  }
  if (msg.includes('502') || msg.includes('503') || msg.includes('504')) {
    return 'server_error';
  }

  return 'unknown';
}

/**
 * Execute gh CLI command with retry logic
 *
 * Retries gh CLI commands for transient errors (network issues, timeouts, 5xx errors, rate limits).
 * Uses exponential backoff (2s, 4s, 8s). Logs retry attempts and final failures.
 * Non-retryable errors (like validation errors) fail immediately.
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
  let lastError: Error | undefined;
  let firstError: Error | undefined;
  let lastExitCode: number | undefined;
  let firstExitCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await ghCli(args, options);

      // Success after retry - log recovery
      if (attempt > 1 && firstError) {
        logger.info('ghCliWithRetry: succeeded after retry', {
          attempt,
          command: `gh ${args.join(' ')}`,
          initialErrorType: classifyErrorType(firstError, firstExitCode),
          initialErrorMessage: firstError.message,
        });
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Extract exit code from GitHubCliError (which has an exitCode property)
      // or try to parse HTTP status from error message as fallback
      lastExitCode = (error as { exitCode?: number }).exitCode;
      if (lastExitCode === undefined && lastError.message) {
        // Fallback: try to extract HTTP status from error message (e.g., "HTTP 429")
        const statusMatch = lastError.message.match(/HTTP\s+(\d{3})/i);
        if (statusMatch) {
          lastExitCode = parseInt(statusMatch[1], 10);
        }
      }

      // Capture first error for diagnostics
      if (attempt === 1) {
        firstError = lastError;
        firstExitCode = lastExitCode;
      }

      if (!isRetryableError(error, lastExitCode)) {
        // Non-retryable error, fail immediately
        throw lastError;
      }

      if (attempt === maxRetries) {
        // Final attempt failed - log all attempts exhausted
        logger.warn('ghCliWithRetry: all attempts failed', {
          maxRetries,
          command: `gh ${args.join(' ')}`,
          errorType: classifyErrorType(lastError, lastExitCode),
          exitCode: lastExitCode,
          errorMessage: lastError.message,
        });
        throw lastError;
      }

      // Log based on attempt number
      const errorType = classifyErrorType(lastError, lastExitCode);
      if (attempt === 1) {
        // Initial failure - log at INFO level since retry is designed for this
        logger.info('ghCliWithRetry: initial attempt failed, will retry', {
          attempt,
          maxRetries,
          command: `gh ${args.join(' ')}`,
          errorType,
          exitCode: lastExitCode,
          errorMessage: lastError.message,
        });
      } else {
        // Subsequent failures - log at WARN level
        logger.warn('ghCliWithRetry: retry attempt failed, will retry again', {
          attempt,
          maxRetries,
          command: `gh ${args.join(' ')}`,
          errorType,
          exitCode: lastExitCode,
          errorMessage: lastError.message,
        });
      }

      // Exponential backoff: 2s, 4s, 8s
      const delayMs = Math.pow(2, attempt) * 1000;
      logger.debug('ghCliWithRetry: waiting before retry', {
        attempt,
        retryDelayMs: delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw lastError || new Error('Unexpected retry failure');
}
