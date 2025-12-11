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
 * Execute a git command safely with proper error handling
 */
export async function git(args: string[], options: GitOptions = {}): Promise<string> {
  try {
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
      cwd: options.cwd || process.cwd(),
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
 */
export async function getCurrentBranch(options?: GitOptions): Promise<string> {
  const result = await git(['rev-parse', '--abbrev-ref', 'HEAD'], options);
  return result.trim();
}

/**
 * Check if there are uncommitted changes (staged, unstaged, or untracked)
 */
export async function hasUncommittedChanges(options?: GitOptions): Promise<boolean> {
  const result = await git(['status', '--porcelain'], options);
  return result.trim().length > 0;
}

/**
 * Check if the current branch has a remote tracking branch
 */
export async function hasRemoteTracking(branch?: string, options?: GitOptions): Promise<boolean> {
  try {
    const branchName = branch || (await getCurrentBranch(options));
    await git(['rev-parse', '--verify', `origin/${branchName}`], options);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if the current branch is pushed (local and remote are in sync)
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
 */
export async function getMainBranch(options?: GitOptions): Promise<string> {
  try {
    // Check if main exists
    await git(['rev-parse', '--verify', 'main'], options);
    return 'main';
  } catch {
    try {
      // Check if master exists
      await git(['rev-parse', '--verify', 'master'], options);
      return 'master';
    } catch {
      throw new GitError('Could not find main or master branch');
    }
  }
}
