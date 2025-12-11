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
        result.exitCode,
        result.stderr || undefined
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
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Resolve repository - use provided repo or get current repo
 */
export async function resolveRepo(repo?: string): Promise<string> {
  if (repo) {
    return repo;
  }
  return getCurrentRepo();
}

/**
 * Get PR details
 * If prNumber is 0 or undefined, gets PR for current branch
 */
export async function getPR(prNumber?: number, repo?: string) {
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

  return ghCliJson(args, options);
}

/**
 * Get all comments for a PR
 */
export async function getPRComments(prNumber: number, repo?: string): Promise<any[]> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson<any[]>(
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
 */
export async function postPRComment(prNumber: number, body: string, repo?: string): Promise<void> {
  const resolvedRepo = await resolveRepo(repo);
  await ghCli(['pr', 'comment', prNumber.toString(), '--body', body], { repo: resolvedRepo });
}

/**
 * Get PR review comments from specific user
 */
export async function getPRReviewComments(
  prNumber: number,
  username: string,
  repo?: string
): Promise<any[]> {
  const resolvedRepo = await resolveRepo(repo);
  const result = await ghCli(
    [
      'api',
      `repos/${resolvedRepo}/pulls/${prNumber}/comments`,
      '--jq',
      `.[] | select(.user.login == "${username}")`,
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
  const comments: any[] = [];

  for (const line of lines) {
    try {
      comments.push(JSON.parse(line));
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
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (network errors, 5xx server errors)
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
