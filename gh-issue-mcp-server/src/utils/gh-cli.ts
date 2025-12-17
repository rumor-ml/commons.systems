/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError } from '@commons/mcp-common/errors';
import { isSystemError } from '@commons/mcp-common/errors';

export interface GhCliOptions {
  repo?: string;
  timeout?: number;
}

/**
 * Execute a GitHub CLI command safely with proper error handling
 */
export async function ghCli(args: string[], options: GhCliOptions = {}): Promise<string> {
  // Add repo flag if provided (defined here so it's available in catch block)
  const fullArgs = options.repo ? ['--repo', options.repo, ...args] : args;

  try {
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
    };

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

    // Re-throw non-Error types unchanged
    if (!(error instanceof Error)) {
      throw error;
    }

    // Re-throw system errors unchanged
    if (isSystemError(error)) {
      throw error;
    }

    // Only wrap actual gh CLI failures
    throw new GitHubCliError(
      `Failed to execute gh CLI (gh ${fullArgs.join(' ')}): ${error.message}`,
      1,
      error.message
    );
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new GitHubCliError(
      `Failed to parse JSON response from gh CLI: ${errorMessage}`,
      1,
      errorMessage
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new GitHubCliError(
      "Failed to get current repository. Make sure you're in a git repository or provide the --repo flag.",
      1,
      errorMessage
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
