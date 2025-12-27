/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError, ParsingError } from './errors.js';

export interface GhCliOptions {
  repo?: string;
  timeout?: number;
}

/**
 * Execute a GitHub CLI command safely with proper error handling
 */
export async function ghCli(args: string[], options: GhCliOptions = {}): Promise<string> {
  try {
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
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
    // TODO: See issue #443 - Distinguish programming errors from operational errors
    if (error instanceof GitHubCliError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new GitHubCliError(
        `Failed to execute gh CLI: ${error.message}`,
        undefined,
        undefined,
        undefined,
        error
      );
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
    // Provide context about what command failed and show output snippet
    const outputSnippet = output.length > 200 ? output.substring(0, 200) + '...' : output;
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ParsingError(
      `Failed to parse JSON response from gh CLI: ${errorMessage}\n` +
        `Command: gh ${args.join(' ')}\n` +
        `Output (first 200 chars): ${outputSnippet}`,
      error instanceof Error ? error : undefined
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
    // TODO: See issue #441 - Preserve original error details (currently discards cause chain)
    throw new GitHubCliError(
      `Failed to get current repository. Make sure you're in a git repository or provide the --repo flag. Original error: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof GitHubCliError ? error.exitCode : undefined,
      error instanceof GitHubCliError ? error.stderr : undefined,
      undefined, // stdout parameter
      error instanceof Error ? error : undefined // cause parameter
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
 * Node.js error codes that indicate retryable network/connection issues
 *
 * These are stable error codes from the Node.js error API, preferred over
 * string matching on error messages.
 */
const RETRYABLE_ERROR_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'EPIPE',
];

/**
 * Check if an error is retryable (network errors, 5xx server errors, rate limits)
 *
 * Determines if an error should be retried using a priority-based approach:
 * 1. Exit code (most reliable) - checks for known HTTP error codes
 * 2. Node.js error.code (stable API) - checks for network/connection errors
 * 3. Message pattern matching (fallback) - for when structured data is missing
 *
 * Current limitation: gh CLI wraps errors in generic Error objects, losing HTTP
 * status codes and error types. We must parse error messages, which are fragile
 * to GitHub CLI updates. See issue #453 for migration to structured error types.
 *
 * @param error - Error to check for retryability
 * @param exitCode - Optional exit code from the CLI command
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
// TODO: See issue #453 - Use error types instead of string matching for retry logic
function isRetryableError(error: unknown, exitCode?: number): boolean {
  // Priority 1: Exit code (most reliable when available)
  if (exitCode !== undefined) {
    if ([429, 502, 503, 504].includes(exitCode)) {
      return true;
    }
  }

  if (error instanceof Error) {
    // Priority 2: Node.js error codes (stable API)
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code && RETRYABLE_ERROR_CODES.includes(nodeError.code)) {
      return true;
    }

    // Priority 3: Message pattern matching (fallback, less reliable)
    // This is fragile - error messages can change with GitHub CLI versions
    const msg = error.message.toLowerCase();
    const patterns = [
      // Network errors
      'network',
      'timeout',
      'socket',
      'connection',
      'econnreset', // Fallback if error.code missing
      'econnrefused',
      // HTTP status codes (in case exitCode not provided)
      '429',
      '502',
      '503',
      '504',
      // Rate limit messages (multiple phrasings - fragile to changes)
      'rate limit',
      'api rate limit exceeded',
      'rate_limit_exceeded',
      'quota exceeded',
      'too many requests',
    ];

    return patterns.some((pattern) => msg.includes(pattern));
  }
  return false;
}

/**
 * Classify error type for logging and diagnostics
 *
 * Categorizes errors into types for pattern analysis and debugging.
 * Uses a priority-based approach:
 * 1. Exit code (most reliable when available)
 * 2. Node.js error codes (stable API)
 * 3. Message pattern matching (fallback, less reliable)
 *
 * @param error - Error to classify
 * @param exitCode - Optional exit code for more reliable classification
 * @returns Error type string (network, timeout, rate_limit, permission, not_found, server_error, unknown)
 */
function classifyErrorType(error: Error, exitCode?: number): string {
  // Priority 1: Use exit code for classification (most reliable)
  if (exitCode !== undefined) {
    if (exitCode === 429) return 'rate_limit';
    if ([502, 503, 504].includes(exitCode)) return 'server_error';
    if ([401, 403].includes(exitCode)) return 'permission';
    if (exitCode === 404) return 'not_found';
  }

  // Priority 2: Use Node.js error codes (stable API)
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code) {
    if (['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'ENOTFOUND'].includes(nodeError.code)) {
      return 'network';
    }
    if (nodeError.code === 'ETIMEDOUT') {
      return 'timeout';
    }
  }

  // Priority 3: Message pattern matching (fallback, less reliable)
  const msg = error.message.toLowerCase();

  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return 'network';
  }
  if (msg.includes('timeout') || msg.includes('etimedout')) {
    return 'timeout';
  }
  if (msg.includes('rate limit') || msg.includes('429')) {
    return 'rate_limit';
  }
  if (msg.includes('forbidden') || msg.includes('401') || msg.includes('403')) {
    return 'permission';
  }
  if (msg.includes('404') || msg.includes('not found')) {
    return 'not_found';
  }
  if (msg.includes('502') || msg.includes('503') || msg.includes('504')) {
    return 'server_error';
  }

  return 'unknown';
}

/**
 * Execute gh CLI command with retry logic
 *
 * Retries gh CLI commands for transient errors (network issues, timeouts, 5xx errors, rate limits).
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
  let firstError: Error | undefined;
  let lastExitCode: number | undefined;
  let firstExitCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await ghCli(args, options);

      // Success after retry - log recovery
      if (attempt > 1 && firstError) {
        console.error(
          `[gh-issue] INFO ghCliWithRetry: succeeded after retry (attempt ${attempt}/${maxRetries}, errorType: ${classifyErrorType(firstError, firstExitCode)}, command: gh ${args.join(' ')})`
        );
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Extract exit code from GitHubCliError (which has an exitCode property)
      // or try to parse HTTP status from error message as fallback
      lastExitCode = (error as { exitCode?: number }).exitCode;
      if (lastExitCode === undefined && lastError.message) {
        // Fallback: try to extract HTTP status from error message (e.g., "HTTP 429")
        const statusMatch = lastError.message.match(/HTTP\s+(\d{3})/i);
        if (statusMatch) {
          lastExitCode = parseInt(statusMatch[1], 10);
        }
      }

      // Capture first error for diagnostics
      if (attempt === 1) {
        firstError = lastError;
        firstExitCode = lastExitCode;
      }

      if (!isRetryableError(error, lastExitCode)) {
        // Non-retryable error, fail immediately
        console.error(
          `[gh-issue] ghCliWithRetry: non-retryable error (attempt ${attempt}/${maxRetries}, errorType: ${classifyErrorType(lastError, lastExitCode)}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')})`
        );
        throw lastError;
      }

      if (attempt === maxRetries) {
        // Final attempt failed - log all attempts exhausted
        console.error(
          `[gh-issue] ghCliWithRetry: all attempts failed (maxRetries: ${maxRetries}, errorType: ${classifyErrorType(lastError, lastExitCode)}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
        throw lastError;
      }

      // Log based on attempt number
      const errorType = classifyErrorType(lastError, lastExitCode);
      if (attempt === 1) {
        // Initial failure - log at INFO level since retry is designed for this
        console.error(
          `[gh-issue] INFO ghCliWithRetry: initial attempt failed, will retry (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      } else {
        // Subsequent failures - log at WARN level
        console.error(
          `[gh-issue] WARN ghCliWithRetry: retry attempt failed, will retry again (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      }

      // Exponential backoff: 2s, 4s, 8s
      const delayMs = Math.pow(2, attempt) * 1000;
      await sleep(delayMs);
    }
  }

  throw lastError || new Error('Unexpected retry failure');
}
