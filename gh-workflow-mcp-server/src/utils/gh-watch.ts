/**
 * GitHub CLI watch command utilities
 *
 * Provides wrappers around `gh run watch` and `gh pr checks --watch` commands
 * with timeout support and structured result handling.
 */

import { execa } from 'execa';
import { GitHubCliError } from './errors.js';
import { CHECK_ICONS } from '../constants.js';

export interface WatchResult {
  /** Whether the watch completed successfully (exit code 0) */
  success: boolean;
  /** Exit code from gh watch command */
  exitCode: number;
  /** Whether the watch timed out */
  timedOut: boolean;
  /** Human-readable output from watch command */
  output: string;
}

export interface WatchOptions {
  /** Timeout in milliseconds */
  timeout: number;
  /** Repository in format "owner/repo" (optional) */
  repo?: string;
  /** Enable fail-fast mode for PR checks (optional) */
  failFast?: boolean;
}

export interface Check {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface OverallStatus {
  status: string;
  successCount: number;
  failureCount: number;
  otherCount: number;
}

/**
 * Execute a gh watch command with timeout support using AbortController
 *
 * Uses AbortController for timeout enforcement to avoid orphaned processes.
 * When timeout expires, the controller aborts the execa process cleanly, which
 * throws an error with `isCanceled: true`. This is detected to return a timeout
 * result rather than treating it as a command failure.
 *
 * @param args - Command arguments (e.g., ['run', 'watch', '123', '--exit-status'])
 * @param timeoutMs - Timeout in milliseconds
 * @returns Watch result with success status, exit code, and output
 */
async function createAbortableWatch(args: string[], timeoutMs: number): Promise<WatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await execa('gh', args, {
      cancelSignal: controller.signal,
      reject: false,
      all: true,
    });

    clearTimeout(timer);

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode ?? 1,
      timedOut: false,
      output: result.all || '',
    };
  } catch (error: any) {
    clearTimeout(timer);

    // Check if error was due to abort/timeout
    if (error.isCanceled) {
      return {
        success: false,
        exitCode: 124, // Standard timeout exit code
        timedOut: true,
        output: '',
      };
    }

    // Other execution errors - log details for diagnostics
    console.error(
      `[gh-workflow] Watch command execution failed (command: gh ${args.join(' ')}, exitCode: ${error.exitCode || 'none'}, stderr: ${error.stderr || 'none'})`
    );
    throw new GitHubCliError(
      `Watch command failed: ${error.message}`,
      error.exitCode,
      error.stderr,
      undefined,
      error
    );
  }
}

/**
 * Watch a workflow run until completion using `gh run watch`
 *
 * Uses native GitHub CLI watch command for real-time completion detection.
 * The watch command polls GitHub's API internally and exits when the run completes.
 *
 * @param runId - Workflow run ID to watch
 * @param options - Watch options including timeout and optional repo
 * @returns Watch result indicating success, exit code, and whether it timed out
 *
 * @throws {GitHubCliError} If watch command fails (excluding timeout)
 *
 * @example
 * const result = await watchWorkflowRun(123456, { timeout: 600000 });
 * if (result.timedOut) {
 *   throw new TimeoutError('Run did not complete in time');
 * }
 */
export async function watchWorkflowRun(runId: number, options: WatchOptions): Promise<WatchResult> {
  const args = ['run', 'watch', runId.toString(), '--exit-status'];

  if (options.repo) {
    args.unshift('--repo', options.repo);
  }

  return createAbortableWatch(args, options.timeout);
}

/**
 * Watch PR checks until completion using `gh pr checks --watch`
 *
 * Uses native GitHub CLI watch command for real-time completion detection.
 * The watch command polls GitHub's API internally and exits when all checks complete.
 *
 * @param prNumber - Pull request number to watch
 * @param options - Watch options including timeout and optional repo
 * @returns Watch result indicating success, exit code, and whether it timed out
 *
 * @throws {GitHubCliError} If watch command fails (excluding timeout)
 *
 * @example
 * const result = await watchPRChecks(42, { timeout: 600000 });
 * if (result.timedOut) {
 *   throw new TimeoutError('Checks did not complete in time');
 * }
 */
export async function watchPRChecks(prNumber: number, options: WatchOptions): Promise<WatchResult> {
  const args = ['pr', 'checks', prNumber.toString(), '--watch'];

  if (options.failFast) {
    args.push('--fail-fast');
  }

  if (options.repo) {
    args.unshift('--repo', options.repo);
  }

  return createAbortableWatch(args, options.timeout);
}

/**
 * Get icon for check conclusion/status
 *
 * Maps check conclusions to visual indicators:
 * - success: ✓
 * - failure/timed_out: ✗
 * - cancelled/skipped/null: ○
 * - unknown: ○ (fallback)
 *
 * Used for formatting check status in PR monitoring output.
 *
 * @param conclusion - Check conclusion (success, failure, etc.) or null
 * @returns Icon character for display
 */
export function getCheckIcon(conclusion: string | null): string {
  if (conclusion === null) {
    return CHECK_ICONS.null;
  }
  return CHECK_ICONS[conclusion] || CHECK_ICONS.null;
}

/**
 * Determine overall status from a list of checks
 *
 * Analyzes check conclusions to provide an overall status summary with counts.
 * Used for PR check monitoring to determine if checks passed, failed, or mixed.
 *
 * @param checks - Array of checks with conclusion field
 * @returns Overall status with success/failure/other counts
 */
export function determineOverallStatus(checks: Check[]): OverallStatus {
  let successCount = 0;
  let failureCount = 0;

  for (const check of checks) {
    if (check.conclusion === 'success') {
      successCount++;
    } else if (check.conclusion === 'failure' || check.conclusion === 'timed_out') {
      failureCount++;
    }
  }

  const otherCount = checks.length - successCount - failureCount;

  let status: string;
  if (failureCount > 0) {
    status = 'FAILED';
  } else if (successCount === checks.length) {
    status = 'SUCCESS';
  } else {
    status = 'MIXED';
  }

  return {
    status,
    successCount,
    failureCount,
    otherCount,
  };
}
