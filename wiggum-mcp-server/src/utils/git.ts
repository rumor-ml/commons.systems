/**
 * Git command utilities
 */

import { execa } from 'execa';
import { GitError } from './errors.js';

export interface GitOptions {
  cwd?: string;
  timeout?: number;
}

/**
 * Get the git repository root directory
 *
 * Executes `git rev-parse --show-toplevel` to find the repository root.
 * Falls back to process.cwd() if not in a git repository.
 * Logs warnings when git command fails or encounters errors.
 *
 * @returns The absolute path to the git repository root, or process.cwd() as fallback
 *
 * @example
 * ```typescript
 * const root = await getGitRoot();
 * console.log(root); // "/Users/user/my-repo"
 * ```
 */
export async function getGitRoot(): Promise<string> {
  try {
    const result = await execa('git', ['rev-parse', '--show-toplevel'], {
      reject: false,
    });

    if (result.exitCode === 0 && result.stdout) {
      return result.stdout.trim();
    }

    // Log non-zero exit code
    if (result.exitCode !== 0) {
      console.warn(
        `getGitRoot: git rev-parse failed with exit code ${result.exitCode}. stderr: ${result.stderr}. Falling back to process.cwd()`
      );
    }
  } catch (error) {
    // Log unexpected errors
    console.warn(
      `getGitRoot: unexpected error: ${error instanceof Error ? error.message : String(error)}. Falling back to process.cwd()`
    );
  }

  return process.cwd();
}

/**
 * Execute a git command safely with proper error handling
 *
 * Runs git commands with automatic working directory resolution,
 * timeout support, and comprehensive error handling. All errors
 * are wrapped in GitError for consistent error handling.
 *
 * @param args - Git command arguments (e.g., ['status', '--porcelain'])
 * @param options - Optional execution options (cwd, timeout)
 * @returns The stdout from the git command
 * @throws {GitError} When git command fails or exits with non-zero code
 *
 * @example
 * ```typescript
 * const status = await git(['status', '--porcelain']);
 * const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
 * ```
 */
export async function git(args: string[], options: GitOptions = {}): Promise<string> {
  try {
    const cwd = options.cwd || (await getGitRoot());
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
      cwd: cwd,
    };

    const result = await execa('git', args, execaOptions);

    if (result.exitCode !== 0) {
      throw new GitError(
        `Git command failed: ${result.stderr || result.stdout}`,
        result.exitCode,
        result.stderr || undefined
      );
    }

    return result.stdout || '';
  } catch (error) {
    if (error instanceof GitError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new GitError(`Failed to execute git: ${error.message}`);
    }
    throw new GitError(`Failed to execute git: ${String(error)}`);
  }
}

/**
 * Get the current branch name
 *
 * @param options - Optional git execution options
 * @returns The current branch name (e.g., "main", "feature-123")
 * @throws {GitError} When not in a git repository or git command fails
 *
 * @example
 * ```typescript
 * const branch = await getCurrentBranch();
 * console.log(branch); // "feature-123"
 * ```
 */
export async function getCurrentBranch(options?: GitOptions): Promise<string> {
  const result = await git(['rev-parse', '--abbrev-ref', 'HEAD'], options);
  return result.trim();
}

/**
 * Check if there are uncommitted changes (staged, unstaged, or untracked)
 *
 * Uses `git status --porcelain` to detect any changes in the working tree.
 *
 * @param options - Optional git execution options
 * @returns true if there are any uncommitted changes, false otherwise
 * @throws {GitError} When git command fails
 *
 * @example
 * ```typescript
 * if (await hasUncommittedChanges()) {
 *   console.log("Please commit your changes");
 * }
 * ```
 */
export async function hasUncommittedChanges(options?: GitOptions): Promise<boolean> {
  const result = await git(['status', '--porcelain'], options);
  return result.trim().length > 0;
}

/**
 * Check if the current branch has a remote tracking branch
 *
 * Verifies if a remote branch exists on origin for the specified branch.
 * Distinguishes between expected errors (no remote branch, exit code 128)
 * and unexpected errors (which are logged as warnings).
 *
 * @param branch - Branch name to check (defaults to current branch)
 * @param options - Optional git execution options
 * @returns true if remote tracking branch exists, false otherwise
 *
 * @example
 * ```typescript
 * if (await hasRemoteTracking("feature-123")) {
 *   console.log("Branch is tracked on remote");
 * }
 * ```
 */
export async function hasRemoteTracking(branch?: string, options?: GitOptions): Promise<boolean> {
  try {
    const branchName = branch || (await getCurrentBranch(options));
    await git(['rev-parse', '--verify', `origin/${branchName}`], options);
    return true;
  } catch (error) {
    // Expected: remote branch doesn't exist (GitError with exit code 128)
    if (error instanceof GitError && error.exitCode === 128) {
      return false;
    }

    // Unexpected error - log and return false
    console.warn(
      `hasRemoteTracking: unexpected error checking remote tracking for ${branch || 'current branch'}: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * Check if the current branch is pushed (local and remote are in sync)
 *
 * Verifies that:
 * 1. Remote tracking branch exists
 * 2. Local and remote commits are identical (same SHA)
 *
 * @param branch - Branch name to check (defaults to current branch)
 * @param options - Optional git execution options
 * @returns true if branch exists on remote and is in sync, false otherwise
 *
 * @example
 * ```typescript
 * if (!await isBranchPushed()) {
 *   console.log("Branch needs to be pushed");
 * }
 * ```
 */
export async function isBranchPushed(branch?: string, options?: GitOptions): Promise<boolean> {
  const branchName = branch || (await getCurrentBranch(options));

  // Check if remote tracking exists
  if (!(await hasRemoteTracking(branchName, options))) {
    return false;
  }

  // Check if local and remote are in sync
  const localSha = await git(['rev-parse', branchName], options);
  const remoteSha = await git(['rev-parse', `origin/${branchName}`], options);

  return localSha.trim() === remoteSha.trim();
}

/**
 * Get the main branch name (main or master)
 *
 * Checks for "main" first, then falls back to "master".
 * Throws error if neither exists.
 *
 * @param options - Optional git execution options
 * @returns "main" or "master"
 * @throws {GitError} When neither main nor master branch exists
 *
 * @example
 * ```typescript
 * const mainBranch = await getMainBranch();
 * console.log(mainBranch); // "main" or "master"
 * ```
 */
export async function getMainBranch(options?: GitOptions): Promise<string> {
  try {
    // Check if main exists
    await git(['rev-parse', '--verify', 'main'], options);
    return 'main';
  } catch (error) {
    // Log the error and try master as fallback
    console.debug(
      `getMainBranch: main branch not found, trying master: ${error instanceof Error ? error.message : String(error)}`
    );
    try {
      // Check if master exists
      await git(['rev-parse', '--verify', 'master'], options);
      return 'master';
    } catch (masterError) {
      // Log the error for both branches
      console.error(
        `getMainBranch: neither main nor master branch found. main error: ${error instanceof Error ? error.message : String(error)}, master error: ${masterError instanceof Error ? masterError.message : String(masterError)}`
      );
      throw new GitError('Could not find main or master branch');
    }
  }
}
