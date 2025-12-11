/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError } from './errors.js';

export interface GhCliOptions {
  repo?: string;
  timeout?: number;
  cwd?: string;
}

/**
 * Execute a GitHub CLI command safely with proper error handling
 */
export async function ghCli(args: string[], options: GhCliOptions = {}): Promise<string> {
  try {
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
      cwd: options.cwd || process.cwd(),
    };

    // Add repo flag if provided
    const fullArgs = options.repo ? ['--repo', options.repo, ...args] : args;

    const result = await execa('gh', fullArgs, execaOptions);

    if (result.exitCode !== 0) {
      throw new GitHubCliError(
        `GitHub CLI command failed: ${result.stderr || result.stdout}`,
        result.exitCode,
        result.stderr || undefined
      );
    }

    return result.stdout || '';
  } catch (error) {
    if (error instanceof GitHubCliError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new GitHubCliError(`Failed to execute gh CLI: ${error.message}`);
    }
    throw new GitHubCliError(`Failed to execute gh CLI: ${String(error)}`);
  }
}

/**
 * Execute a GitHub CLI command and parse JSON output
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
 */
export async function getCurrentRepo(): Promise<string> {
  try {
    const result = await ghCli(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    return result.trim();
  } catch (error) {
    throw new GitHubCliError(
      "Failed to get current repository. Make sure you're in a git repository or provide the --repo flag."
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
  return result
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
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

      if (!isRetryableError(error) || attempt === maxRetries) {
        throw lastError;
      }

      // Exponential backoff: 2s, 4s, 8s
      const delayMs = Math.pow(2, attempt) * 1000;
      await sleep(delayMs);
    }
  }

  throw lastError || new Error('Unexpected retry failure');
}
