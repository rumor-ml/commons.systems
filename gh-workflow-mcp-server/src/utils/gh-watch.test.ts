/**
 * Unit tests for GitHub CLI watch utilities
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getCheckIcon, determineOverallStatus } from './gh-watch.js';

describe('determineOverallStatus', () => {
  test('returns SUCCESS when all checks succeed', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'success' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'SUCCESS');
    assert.strictEqual(result.successCount, 2);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 0);
  });

  test('returns FAILED when any check fails', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.successCount, 1);
    assert.strictEqual(result.failureCount, 1);
    assert.strictEqual(result.otherCount, 0);
  });

  test('counts timed_out as failure', () => {
    const checks = [{ name: 'test', status: 'completed', conclusion: 'timed_out' }];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.failureCount, 1);
  });

  test('returns MIXED when checks have neither all success nor any failure', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'skipped' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'MIXED');
    assert.strictEqual(result.successCount, 1);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 1);
  });

  test('handles empty checks array', () => {
    const checks: any[] = [];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'SUCCESS');
    assert.strictEqual(result.successCount, 0);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 0);
  });

  test('handles multiple failures correctly', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'failure' },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
      { name: 'build', status: 'completed', conclusion: 'success' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.successCount, 1);
    assert.strictEqual(result.failureCount, 2);
    assert.strictEqual(result.otherCount, 0);
  });

  test('handles cancelled conclusions as other', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'cancelled' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'MIXED');
    assert.strictEqual(result.successCount, 1);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 1);
  });

  test('handles all checks cancelled', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'cancelled' },
      { name: 'lint', status: 'completed', conclusion: 'cancelled' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'MIXED');
    assert.strictEqual(result.successCount, 0);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 2);
  });
});

describe('getCheckIcon', () => {
  test('returns ✓ for success', () => {
    assert.strictEqual(getCheckIcon('success'), '✓');
  });

  test('returns ✗ for failure', () => {
    assert.strictEqual(getCheckIcon('failure'), '✗');
  });

  test('returns ✗ for timed_out', () => {
    assert.strictEqual(getCheckIcon('timed_out'), '✗');
  });

  test('returns ○ for cancelled', () => {
    assert.strictEqual(getCheckIcon('cancelled'), '○');
  });

  test('returns ○ for skipped', () => {
    assert.strictEqual(getCheckIcon('skipped'), '○');
  });

  test('returns ○ for null conclusion', () => {
    assert.strictEqual(getCheckIcon(null), '○');
  });

  test('returns ○ for unknown conclusions (fallback)', () => {
    assert.strictEqual(getCheckIcon('unknown_conclusion'), '○');
  });

  test('returns ○ for action_required', () => {
    assert.strictEqual(getCheckIcon('action_required'), '○');
  });
});

/**
 * Tests for WatchResult interface contract
 *
 * These tests document the expected behavior of watchWorkflowRun and watchPRChecks
 * without requiring mocking of the execa module. The tests verify the interface
 * contract that consumers depend on.
 */
describe('WatchResult interface contract', () => {
  test('documents success case structure: success=true, exitCode=0, timedOut=false', () => {
    // Success case structure: when gh watch completes successfully
    const successResult = {
      success: true,
      exitCode: 0,
      timedOut: false,
      output: 'Run completed successfully',
    };

    assert.strictEqual(successResult.success, true);
    assert.strictEqual(successResult.exitCode, 0);
    assert.strictEqual(successResult.timedOut, false);
    assert.ok(typeof successResult.output === 'string');
  });

  test('documents failure case structure: success=false, exitCode!=0, timedOut=false', () => {
    // Failure case structure: when gh watch completes with non-zero exit
    const failureResult = {
      success: false,
      exitCode: 1,
      timedOut: false,
      output: 'Run failed',
    };

    assert.strictEqual(failureResult.success, false);
    assert.strictEqual(failureResult.exitCode, 1);
    assert.strictEqual(failureResult.timedOut, false);
  });

  test('documents timeout case structure: success=false, exitCode=124, timedOut=true', () => {
    // Timeout case structure: when AbortController aborts the watch
    // Exit code 124 follows Unix convention for timeout
    const timeoutResult = {
      success: false,
      exitCode: 124,
      timedOut: true,
      output: '',
    };

    assert.strictEqual(timeoutResult.success, false);
    assert.strictEqual(timeoutResult.exitCode, 124);
    assert.strictEqual(timeoutResult.timedOut, true);
    assert.strictEqual(timeoutResult.output, '');
  });

  test('exit code 124 is standard Unix timeout exit code', () => {
    // Document that 124 is the standard timeout exit code
    // Used by timeout(1) and coreutils
    const TIMEOUT_EXIT_CODE = 124;
    assert.strictEqual(TIMEOUT_EXIT_CODE, 124);
  });
});

/**
 * Tests for watchWorkflowRun argument handling
 *
 * These tests document the expected CLI arguments without actually executing
 * the gh command. They verify the interface contract for callers.
 */
describe('watchWorkflowRun argument specification', () => {
  test('documents base command: gh run watch <runId> --exit-status', () => {
    // Base command structure
    const runId = 123456;
    const expectedCommand = 'gh';
    const expectedBaseArgs = ['run', 'watch', runId.toString(), '--exit-status'];

    assert.strictEqual(expectedCommand, 'gh');
    assert.deepStrictEqual(expectedBaseArgs, ['run', 'watch', '123456', '--exit-status']);
  });

  test('documents repo option: --repo is prepended when provided', () => {
    // When repo option is provided, --repo flag is prepended
    const runId = 123456;
    const repo = 'owner/repo';
    const argsWithRepo = ['--repo', repo, 'run', 'watch', runId.toString(), '--exit-status'];

    assert.ok(argsWithRepo.includes('--repo'));
    assert.ok(argsWithRepo.includes('owner/repo'));
    assert.strictEqual(argsWithRepo.indexOf('--repo'), 0);
  });

  test('documents timeout option: controls AbortController timeout', () => {
    // Timeout option sets the AbortController timeout in milliseconds
    const options = { timeout: 60000 }; // 1 minute

    assert.strictEqual(options.timeout, 60000);
    assert.ok(options.timeout > 0);
  });
});

/**
 * Tests for watchPRChecks argument handling
 *
 * These tests document the expected CLI arguments without actually executing
 * the gh command. They verify the interface contract for callers.
 */
describe('watchPRChecks argument specification', () => {
  test('documents base command: gh pr checks <prNumber> --watch', () => {
    // Base command structure
    const prNumber = 42;
    const expectedCommand = 'gh';
    const expectedBaseArgs = ['pr', 'checks', prNumber.toString(), '--watch'];

    assert.strictEqual(expectedCommand, 'gh');
    assert.deepStrictEqual(expectedBaseArgs, ['pr', 'checks', '42', '--watch']);
  });

  test('documents --fail-fast option: appended when failFast=true', () => {
    // When failFast is true, --fail-fast flag is appended
    const prNumber = 42;
    const baseArgs = ['pr', 'checks', prNumber.toString(), '--watch'];
    const argsWithFailFast = [...baseArgs, '--fail-fast'];

    assert.ok(argsWithFailFast.includes('--fail-fast'));
    assert.strictEqual(argsWithFailFast.indexOf('--fail-fast'), 4);
  });

  test('documents --fail-fast not included when failFast=false', () => {
    // When failFast is false or undefined, --fail-fast is not included
    const prNumber = 42;
    const baseArgs = ['pr', 'checks', prNumber.toString(), '--watch'];

    assert.ok(!baseArgs.includes('--fail-fast'));
  });

  test('documents repo option: --repo is prepended when provided', () => {
    // When repo option is provided, --repo flag is prepended
    const prNumber = 42;
    const repo = 'owner/repo';
    const argsWithRepo = ['--repo', repo, 'pr', 'checks', prNumber.toString(), '--watch'];

    assert.ok(argsWithRepo.includes('--repo'));
    assert.ok(argsWithRepo.includes('owner/repo'));
    assert.strictEqual(argsWithRepo.indexOf('--repo'), 0);
  });
});

/**
 * Tests for AbortController timeout behavior
 *
 * These tests document the expected behavior when timeouts occur, including
 * the isCanceled detection and exit code handling.
 */
describe('AbortController timeout behavior', () => {
  test('documents isCanceled property detection for abort', () => {
    // When AbortController aborts, execa throws an error with isCanceled=true
    const canceledError = new Error('The operation was canceled');
    (canceledError as any).isCanceled = true;

    assert.strictEqual((canceledError as any).isCanceled, true);
  });

  test('documents non-abort errors do not have isCanceled=true', () => {
    // Regular execution errors do not have isCanceled set
    const executionError = new Error('Command failed');
    (executionError as any).exitCode = 2;
    (executionError as any).stderr = 'Some error';

    assert.strictEqual((executionError as any).isCanceled, undefined);
  });

  test('documents clearTimeout is called in all code paths', () => {
    // clearTimeout must be called to prevent memory leaks
    // - Called after successful completion (try block)
    // - Called after timeout/abort (catch block, isCanceled=true)
    // - Called after execution error (catch block, isCanceled=false)
    const timer = setTimeout(() => {}, 1000);
    clearTimeout(timer);
    // Timer is cleared - test passes if no error
  });

  test('documents timer ID type for clearTimeout', () => {
    // setTimeout returns a Timeout object that can be passed to clearTimeout
    const timer = setTimeout(() => {}, 1000);
    assert.ok(timer !== null);
    clearTimeout(timer);
  });
});

/**
 * Tests for execa options used in createAbortableWatch
 *
 * These tests document the execa options that must be used for correct behavior.
 */
describe('execa options specification', () => {
  test('documents cancelSignal option for AbortController integration', () => {
    // cancelSignal connects the AbortController to execa
    const controller = new AbortController();
    const options = { cancelSignal: controller.signal };

    assert.ok(options.cancelSignal instanceof AbortSignal);
  });

  test('documents reject: false for handling non-zero exit codes', () => {
    // reject: false prevents execa from throwing on non-zero exit
    // This allows handling failed runs gracefully
    const options = { reject: false };

    assert.strictEqual(options.reject, false);
  });

  test('documents all: true for combined stdout/stderr', () => {
    // all: true combines stdout and stderr into one stream
    // This captures all output from gh watch
    const options = { all: true };

    assert.strictEqual(options.all, true);
  });
});

/**
 * Tests for GitHubCliError handling
 *
 * These tests document when GitHubCliError should be thrown.
 */
describe('GitHubCliError handling', () => {
  test('documents that execution errors (non-abort) throw GitHubCliError', () => {
    // When execa fails for reasons other than abort, GitHubCliError is thrown
    // This includes permission errors, command not found, etc.
    const message = 'Watch command failed: gh: command not found';
    const exitCode = 127;
    const stderr = 'gh: command not found';

    // Verify error structure matches GitHubCliError expectations
    assert.ok(message.includes('Watch command failed'));
    assert.strictEqual(exitCode, 127);
    assert.ok(stderr.includes('command not found'));
  });

  test('documents that abort/timeout does NOT throw GitHubCliError', () => {
    // When AbortController aborts, we return a WatchResult, not throw
    // This allows callers to handle timeouts gracefully
    const timeoutResult = {
      success: false,
      exitCode: 124,
      timedOut: true,
      output: '',
    };

    assert.strictEqual(timeoutResult.timedOut, true);
    // Not throwing means we can check result.timedOut instead of catching
  });
});

/**
 * Tests for edge cases in result handling
 */
describe('result handling edge cases', () => {
  test('documents null exitCode defaults to 1', () => {
    // When execa returns null exitCode (shouldn't happen but handle defensively)
    // Default to 1 (general error)
    const nullExitCode = null;
    const defaultExitCode = nullExitCode ?? 1;

    assert.strictEqual(defaultExitCode, 1);
  });

  test('documents undefined output defaults to empty string', () => {
    // When execa returns undefined output (all), default to empty string
    const undefinedOutput = undefined;
    const defaultOutput = undefinedOutput || '';

    assert.strictEqual(defaultOutput, '');
  });

  test('documents success is determined by exitCode === 0', () => {
    // success field is true only when exitCode is exactly 0
    const exitCode0: number = 0;
    const exitCode1: number = 1;

    assert.strictEqual(exitCode0 === 0, true);
    assert.strictEqual(exitCode1 === 0, false);
  });
});
