/**
 * Git command wrapper utilities for safe command execution
 */
import { execa } from 'execa';
import { access, constants } from 'fs/promises';
import { McpError } from './errors.js';

export interface ExecGitOptions {
  cwd?: string;
}

/**
 * Execute a git command safely with proper error handling
 *
 * @param args - Git command arguments (e.g., ['status', '--short'])
 * @param options - Execution options
 * @returns Command stdout
 * @throws {McpError} If command fails
 */
export async function execGit(args: string[], options: ExecGitOptions = {}): Promise<string> {
  try {
    const result = await execa('git', args, {
      cwd: options.cwd,
      reject: false,
    });

    if (result.exitCode !== 0) {
      throw new McpError(
        `Git command failed: ${result.stderr || result.stdout}\n` +
          `Command: git ${args.join(' ')}\n` +
          `Exit code: ${result.exitCode}`
      );
    }

    return result.stdout || '';
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new McpError(
        `Failed to execute git command: ${error.message}\n` + `Command: git ${args.join(' ')}`
      );
    }

    throw new McpError(
      `Failed to execute git command (unexpected error type): git ${args.join(' ')}`
    );
  }
}

/**
 * Get the current branch name
 *
 * @returns Current branch name
 * @throws {McpError} If not in a git repository or command fails
 */
export async function getCurrentBranch(): Promise<string> {
  const output = await execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  return output.trim();
}

/**
 * Check if the working directory is clean (no uncommitted changes)
 *
 * @returns True if working directory is clean, false otherwise
 * @throws {McpError} If git command fails
 */
export async function isWorkingDirectoryClean(): Promise<boolean> {
  const output = await execGit(['status', '--short']);
  return output.trim() === '';
}

/**
 * Fetch and pull latest changes from origin/main
 *
 * @throws {McpError} If fetch or pull fails
 */
export async function fetchAndPullMain(): Promise<void> {
  await execGit(['fetch', 'origin']);
  await execGit(['pull', 'origin', 'main']);
}

/**
 * Create a new worktree at the specified path with a new branch
 *
 * @param path - Absolute path where worktree should be created
 * @param branchName - Name of the new branch to create
 * @throws {McpError} If worktree creation fails
 */
export async function createWorktree(path: string, branchName: string): Promise<void> {
  await execGit(['worktree', 'add', '-b', branchName, path]);
}

/**
 * Set upstream branch for the current branch
 *
 * @param branchName - Branch name to set as upstream
 * @param cwd - Working directory (worktree path)
 * @throws {McpError} If setting upstream fails
 */
export async function setUpstream(branchName: string, cwd: string): Promise<void> {
  await execGit(['branch', '--set-upstream-to', `origin/${branchName}`], { cwd });
}

/**
 * Configure git hooks path using the common git directory
 *
 * This ensures the worktree uses the same hooks as the main worktree.
 *
 * @param cwd - Working directory (worktree path)
 * @throws {McpError} If configuration fails
 */
export async function configureHooksPath(cwd: string): Promise<void> {
  // Get the common git directory (shared across all worktrees)
  const commonDir = await execGit(['rev-parse', '--git-common-dir'], { cwd });
  const hooksPath = `${commonDir.trim()}/hooks`;

  // Set the hooks path to point to the common hooks directory
  await execGit(['config', 'core.hooksPath', hooksPath], { cwd });
}

/**
 * Check if a worktree already exists at the given path
 *
 * @param path - Path to check
 * @returns True if path exists, false otherwise
 */
export async function worktreeExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
