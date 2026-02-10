/**
 * Git command utilities
 */

import { execa } from 'execa';
import { GitError, ValidationError } from './errors.js';
import { logger } from './logger.js';
import { ErrorIds } from '../constants/errorIds.js';

export interface GitOptions {
  cwd?: string;
  timeout?: number;
}

/**
 * Get the git repository root directory
 *
 * Executes `git rev-parse --show-toplevel` to find the repository root.
 * Throws GitError if not in a git repository or git command fails.
 *
 * @returns The absolute path to the git repository root
 * @throws {GitError} When not in a git repository or git command fails
 * @throws {ValidationError} When GitError.create validation fails (programming error)
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

    // Defensive check: empty stdout with exit code 0 should never occur in practice.
    // Normal git behavior: (1) returns repo root path, or (2) fails with exit 128 if not in repo.
    // This check catches anomalies like git corruption, custom git wrappers, or unusual git versions
    // that produce unexpected output patterns. Provides actionable debugging steps.
    if (result.exitCode === 0 && !result.stdout) {
      logger.error('getGitRoot: git command succeeded but stdout is empty', {
        exitCode: result.exitCode,
        stderr: result.stderr || 'none',
        errorId: ErrorIds.GIT_COMMAND_FAILED,
      });
      throw GitError.create(
        'git rev-parse --show-toplevel succeeded but returned empty output. ' +
          'This indicates git corruption or unusual git version behavior. ' +
          'Debugging steps: ' +
          '1. Run `git --version` to check git version (expected: 2.x+). ' +
          '2. Run `git status` to verify repository integrity. ' +
          '3. Check `.git/` directory exists and is readable. ' +
          '4. Verify no GIT_DIR or GIT_WORK_TREE environment variables are set. ' +
          '5. Try `git fsck` to check for repository corruption.',
        result.exitCode,
        result.stderr || undefined,
        ErrorIds.GIT_COMMAND_FAILED
      );
    }

    if (result.exitCode === 0 && result.stdout) {
      return result.stdout.trim();
    }

    // Non-zero exit code means we're not in a git repository or git failed
    throw GitError.create(
      `Not in a git repository or git command failed (exit code ${result.exitCode}). ` +
        `This tool requires running from within a git repository. ` +
        `Command: git rev-parse --show-toplevel. ` +
        `Error: ${result.stderr || 'none'}`,
      result.exitCode,
      result.stderr || undefined,
      result.exitCode === 128 ? ErrorIds.GIT_NOT_A_REPOSITORY : ErrorIds.GIT_COMMAND_FAILED
    );
  } catch (error) {
    // Re-throw ValidationError as-is (programming error, don't wrap)
    if (error instanceof ValidationError) {
      throw error;
    }

    // Re-throw GitError as-is (already properly categorized)
    if (error instanceof GitError) {
      throw error;
    }

    // Log before wrapping unexpected errors for better production visibility
    logger.error('getGitRoot: unexpected error executing git command', {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorId: ErrorIds.GIT_COMMAND_FAILED,
    });

    // Wrap unexpected errors
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : typeof error;
    throw GitError.create(
      `Failed to execute git rev-parse --show-toplevel: ${errorMsg}. ` +
        `Error type: ${errorType}. ` +
        `This tool requires running from within a git repository. ` +
        `Ensure git is installed and the current directory is inside a git repository.`,
      undefined,
      undefined,
      ErrorIds.GIT_COMMAND_FAILED
    );
  }
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
 * @throws {ValidationError} When GitError.create validation fails (programming error)
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
    // TODO(#1883): Use type instead of `any` for execaOptions in git function
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
      cwd: cwd,
    };

    const result = await execa('git', args, execaOptions);

    if (result.exitCode !== 0) {
      const errorOutput = result.stderr || result.stdout || 'no error output';
      throw GitError.create(
        `Git command failed (exit code ${result.exitCode}): ${errorOutput}. ` +
          `Command: git ${args.join(' ')}`,
        result.exitCode,
        result.stderr || undefined,
        ErrorIds.GIT_COMMAND_FAILED
      );
    }

    // Defensive check: null/undefined stdout with success indicates execa internal failure.
    // Empty string "" is valid (e.g., 'git status --porcelain' on clean repo), but null/undefined
    // means execa's stdout capture failed (buffer overflow, broken pipe, or stream error).
    if (result.stdout == null) {
      logger.error(
        'git: Command succeeded but stdout is null/undefined - this indicates execa failure',
        {
          command: `git ${args.join(' ')}`,
          exitCode: result.exitCode,
          stderr: result.stderr || 'none',
          stdoutType: typeof result.stdout,
          errorId: ErrorIds.GIT_COMMAND_FAILED,
        }
      );
      throw GitError.create(
        `Git command succeeded but produced no output (stdout is ${typeof result.stdout}). ` +
          `This may indicate a buffer overflow, stream error, or execa failure. ` +
          `Command: git ${args.join(' ')}`,
        result.exitCode,
        result.stderr || undefined,
        ErrorIds.GIT_COMMAND_FAILED
      );
    }

    return result.stdout;
  } catch (error) {
    // TODO(#487): Broad catch-all hides programming errors - add explicit checks for system/programming errors

    // Re-throw ValidationError as-is (programming error, don't wrap)
    if (error instanceof ValidationError) {
      throw error;
    }

    // Re-throw GitError as-is (already properly categorized)
    if (error instanceof GitError) {
      throw error;
    }

    // Log before wrapping unexpected errors for better observability
    logger.error('git: unexpected error executing git command', {
      command: `git ${args.join(' ')}`,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorId: ErrorIds.GIT_COMMAND_FAILED,
    });

    if (error instanceof Error) {
      const errorType = error.constructor.name;
      throw GitError.create(
        `Failed to execute git command (${errorType}): ${error.message}. ` +
          `Command: git ${args.join(' ')}`,
        undefined,
        undefined,
        ErrorIds.GIT_COMMAND_FAILED
      );
    }
    const errorType = typeof error;
    throw GitError.create(
      `Failed to execute git command (unexpected error type: ${errorType}): ${String(error)}. ` +
        `Command: git ${args.join(' ')}`,
      undefined,
      undefined,
      ErrorIds.GIT_COMMAND_FAILED
    );
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
 * and unexpected errors (which are logged and re-thrown to the caller).
 *
 * @param branch - Branch name to check (defaults to current branch)
 * @param options - Optional git execution options
 * @returns true if remote tracking branch exists, false otherwise
 * @throws {GitError} When git command fails unexpectedly (not exit code 128)
 * @throws {ValidationError} When GitError.create validation fails
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

    // TODO(#1913): Distinguish ValidationError from other unexpected errors in log message
    // Unexpected error - log with actionable context and RE-THROW (don't hide it)
    const errorMsg = error instanceof Error ? error.message : String(error);
    const exitCode = error instanceof GitError ? error.exitCode : undefined;
    logger.error('hasRemoteTracking: unexpected error checking remote tracking branch', {
      branch: branch || 'current branch',
      errorMessage: errorMsg,
      exitCode,
      suggestion:
        'Check network connectivity, remote configuration (git remote -v), and git permissions',
      errorId: ErrorIds.GIT_COMMAND_FAILED,
    });

    // Re-throw to surface the error to the caller
    throw error;
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
  /** Extract error message string from unknown error types */
  const getErrorMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  /** Extract exit code from GitError, undefined otherwise */
  const getExitCode = (err: unknown): number | undefined =>
    err instanceof GitError ? err.exitCode : undefined;

  try {
    // Check if main exists
    await git(['rev-parse', '--verify', 'main'], options);
    return 'main';
  } catch (error) {
    // Only fallback to master if main branch doesn't exist (exit code 128)
    // Re-throw all other errors (network, permissions, validation, etc.)
    // TODO(#1920): Distinguish ValidationError from unexpected errors in log message
    if (!(error instanceof GitError && error.exitCode === 128)) {
      logger.error('getMainBranch: unexpected error checking main branch', {
        errorMessage: getErrorMsg(error),
        exitCode: getExitCode(error),
        errorId: ErrorIds.GIT_COMMAND_FAILED,
      });
      throw error; // Re-throw unexpected errors
    }

    // Expected: main doesn't exist, try master
    logger.debug('getMainBranch: main branch not found, trying master');

    try {
      // Check if master exists
      await git(['rev-parse', '--verify', 'master'], options);
      return 'master';
    } catch (masterError) {
      // Only accept "branch not found" error here too
      // TODO(#1920): Distinguish ValidationError from unexpected errors in log message
      if (!(masterError instanceof GitError && masterError.exitCode === 128)) {
        logger.error('getMainBranch: unexpected error checking master branch', {
          errorMessage: getErrorMsg(masterError),
          exitCode: getExitCode(masterError),
          errorId: ErrorIds.GIT_COMMAND_FAILED,
        });
        throw masterError; // Re-throw unexpected errors
      }

      // Both branches don't exist - preserve full error context from both attempts
      // This helps diagnose if it's a consistent issue (same error for both) or different failures
      const errorMsg = getErrorMsg(error);
      const masterErrorMsg = getErrorMsg(masterError);
      logger.error('getMainBranch: neither main nor master branch found', {
        mainError: errorMsg,
        masterError: masterErrorMsg,
        mainExitCode: getExitCode(error),
        masterExitCode: getExitCode(masterError),
        errorId: ErrorIds.GIT_NO_MAIN_BRANCH,
      });
      throw GitError.create(
        'Could not find main or master branch. ' +
          'Ensure at least one of these branches exists in the repository. ' +
          `Errors: main (${errorMsg}), master (${masterErrorMsg})`,
        undefined,
        undefined,
        ErrorIds.GIT_NO_MAIN_BRANCH
      );
    }
  }
}

/**
 * Safe pattern for branch names to prevent command injection
 *
 * Allows: alphanumeric, hyphens, underscores, forward slashes, dots
 * This covers standard branch naming conventions while preventing shell metacharacters
 */
const SAFE_BRANCH_NAME_PATTERN = /^[a-zA-Z0-9\/_.-]+$/;

/**
 * Check if branch name is safe for use in shell commands
 *
 * Validates that branch name contains only safe characters and doesn't
 * include shell metacharacters that could enable command injection.
 *
 * @param branchName - Branch name to validate
 * @returns true if branch name is safe, false otherwise
 *
 * @example
 * ```typescript
 * isSafeBranchName("feature/123-fix"); // true
 * isSafeBranchName("feature; rm -rf /"); // false
 * ```
 */
export function isSafeBranchName(branchName: string): boolean {
  return SAFE_BRANCH_NAME_PATTERN.test(branchName);
}

/**
 * Sanitize branch name for safe use in shell commands
 *
 * Returns sanitized branch name with warning if sanitization was needed.
 * Removes any characters that don't match SAFE_BRANCH_NAME_PATTERN.
 *
 * @param branchName - Branch name to sanitize
 * @returns Object with sanitized name, whether sanitization occurred, and optional warning
 *
 * @example
 * ```typescript
 * sanitizeBranchNameForShell("feature/123");
 * // Returns: { name: "feature/123", wasSanitized: false }
 *
 * sanitizeBranchNameForShell("feature; rm -rf /");
 * // Returns: {
 * //   name: "feature rm -rf ",
 * //   wasSanitized: true,
 * //   warning: "Branch name contained unsafe characters..."
 * // }
 * ```
 */
export function sanitizeBranchNameForShell(branchName: string): {
  name: string;
  wasSanitized: boolean;
  warning?: string;
} {
  if (isSafeBranchName(branchName)) {
    return { name: branchName, wasSanitized: false };
  }

  // Remove unsafe characters
  const sanitized = branchName.replace(/[^a-zA-Z0-9\/_.-]/g, ' ');

  return {
    name: sanitized,
    wasSanitized: true,
    warning: `Branch name contained unsafe characters and was sanitized. Original: "${branchName}", Sanitized: "${sanitized}"`,
  };
}

/**
 * Extract issue number from branch name
 *
 * Parses branch names in the format "123-feature-name" to extract
 * the leading issue number. Returns null if the branch name doesn't
 * follow this convention.
 *
 * @param branchName - Branch name to parse (e.g., "123-feature-name")
 * @returns Issue number if found, null otherwise
 *
 * @example
 * ```typescript
 * extractIssueNumberFromBranch("123-feature-name"); // 123
 * extractIssueNumberFromBranch("feature-branch"); // null
 * extractIssueNumberFromBranch("456-fix-bug"); // 456
 * ```
 */
export function extractIssueNumberFromBranch(branchName: string): number | null {
  const parts = branchName.split('-');
  if (parts.length === 0) return null;
  const issueNum = parseInt(parts[0], 10);
  return isNaN(issueNum) ? null : issueNum;
}
