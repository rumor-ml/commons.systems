/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError } from './errors.js';
import { getGitRoot } from './git.js';

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
        result.exitCode ?? 1,
        result.stderr || ''
      );
    }

    return result.stdout || '';
  } catch (error) {
    if (error instanceof GitHubCliError) {
      throw error;
    }
    // Preserve original error type for better debugging, but wrap in GitHubCliError
    const originalError = error instanceof Error ? error : new Error(String(error));
    throw new GitHubCliError(
      `Failed to execute gh CLI command (gh ${args.join(' ')}): ${originalError.message}`,
      1,
      originalError.message
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new GitHubCliError(`Failed to parse JSON response from gh CLI: ${errorMsg}`, 1, errorMsg);
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
      error instanceof GitHubCliError ? error.exitCode : 1,
      error instanceof GitHubCliError ? error.stderr : originalMessage
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

  for (const line of lines) {
    try {
      comments.push(JSON.parse(line));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitHubCliError(
        `Failed to parse review comment JSON for PR ${prNumber}: ${errorMsg}. Line: ${line.substring(0, 100)}`,
        1,
        errorMsg
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
 * Check if an error is retryable (network errors, 5xx server errors)
 *
 * Determines if an error should be retried based on the error message.
 * Retryable errors include network issues, timeouts, and 5xx server errors.
 *
 * @param error - Error to check for retryability
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
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('socket') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    );
  }
  return false;
}

/**
 * Execute gh CLI command with retry logic
 *
 * Retries gh CLI commands for transient errors (network issues, timeouts, 5xx errors).
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

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await ghCli(args, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryableError(error)) {
        // Non-retryable error, fail immediately
        throw lastError;
      }

      if (attempt === maxRetries) {
        // Final attempt failed
        console.warn(
          `ghCliWithRetry: all ${maxRetries} attempts failed for command: gh ${args.join(' ')}`
        );
        throw lastError;
      }

      // Exponential backoff: 2s, 4s, 8s
      const delayMs = Math.pow(2, attempt) * 1000;
      console.warn(
        `ghCliWithRetry: attempt ${attempt}/${maxRetries} failed for command: gh ${args.join(' ')}. Retrying in ${delayMs}ms. Error: ${lastError.message}`
      );
      await sleep(delayMs);
    }
  }

  throw lastError || new Error('Unexpected retry failure');
}
