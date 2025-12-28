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
 * When exitCode is unavailable (undefined), gh CLI may wrap errors in generic Error objects,
 * losing HTTP status codes. In these cases we must parse error messages, which are fragile
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
// TODO(#453): Migrate to structured error types for type-safe error handling
function isRetryableError(error: unknown, exitCode?: number): boolean {
  // Priority 1: Exit code (most reliable when available)
  // If exitCode matches retryable HTTP codes (429, 502-504), return true immediately.
  // Otherwise, ALWAYS fall through to Priority 2/3 checks because:
  //   - Network errors (ETIMEDOUT) may have HTTP codes but still be retryable
  //   - Error may have no exitCode but still match retryable patterns
  // NOTE: We never return false based on exitCode alone - only return true for known retryable codes
  if (exitCode !== undefined) {
    if ([429, 502, 503, 504].includes(exitCode)) {
      return true;
    }
    // Fall through to Priority 2/3 - non-retryable HTTP codes don't preclude other retryable conditions
  }

  if (error instanceof Error) {
    // Priority 2: Node.js error codes (stable API)
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code && RETRYABLE_ERROR_CODES.includes(nodeError.code)) {
      return true;
    }

    // Priority 3: Message pattern matching (fallback, less reliable)
    // FRAGILE: gh CLI error message format is not a stable API.
    // If patterns fail to match, see issue #453 for troubleshooting steps and migration plan.
    const msg = error.message.toLowerCase();
    const patterns = [
      // Network errors
      'network',
      'timeout',
      'socket',
      'connection',
      // Error codes as text - catches when error.code is missing or gh CLI wraps Node error in Error
      'econnreset',
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

      // Success after retry - log recovery at WARN level for production visibility
      // INFO may be filtered in production, hiding important recovery patterns
      // Helps identify flaky endpoints or transient GitHub API issues
      // Uses console.error to ensure visibility even when stdout is redirected
      // We log firstError (not lastError) because it's the initial failure that triggered the retry sequence
      if (attempt > 1 && firstError) {
        console.error(
          `[gh-issue] WARN ghCliWithRetry: succeeded after retry - transient failure recovered (attempt ${attempt}/${maxRetries}, errorType: ${classifyErrorType(firstError, firstExitCode)}, command: gh ${args.join(' ')}, impact: Operation delayed by retry, action: Monitor for consistent retry patterns)`
        );
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Attempt to extract exit code from error object (duck-typed - works for GitHubCliError and similar types)
      // Duck typing is used because error may be thrown from external libraries with different Error subclasses
      // Note: exitCode may be undefined if:
      //   - Error object doesn't have exitCode property (e.g., generic Error, network timeout)
      //   - gh CLI exited without setting HTTP status (e.g., subprocess crash)
      //   - Error originated from ghCli() wrapper before CLI invocation
      // When undefined, we fall back to HTTP status extraction from error message text.
      // This fallback is necessary because isRetryableError() needs the exit code to
      // determine if errors are retryable (429, 502-504) without relying solely on fragile string matching.
      lastExitCode = (error as { exitCode?: number }).exitCode;
      if (lastExitCode === undefined && lastError.message) {
        // Try multiple patterns to extract HTTP status from error message
        // Different gh CLI versions and error contexts may format status differently
        const statusPatterns = [
          /HTTP\s+(\d{3})/i, // "HTTP 429"
          /status[:\s]+(\d{3})/i, // "status: 429" or "status 429"
          /(\d{3})\s+Too\s+Many/i, // "429 Too Many Requests"
          /rate\s+limit.*?(\d{3})/i, // "rate limit (429)" or "rate limit exceeded 429"
        ];

        for (const pattern of statusPatterns) {
          const statusMatch = lastError.message.match(pattern);
          if (statusMatch && statusMatch[1]) {
            const parsed = parseInt(statusMatch[1], 10);
            // Validate parsed exit code is a well-formed HTTP status code (100-599)
            // - Must be finite (not Infinity or NaN from malformed input)
            // - Must be safe integer (defensive check, always true for 100-599 range)
            // - Must be in standard HTTP status range (100-599 per RFC 7231)
            // Note: parseInt extracts leading digits, so "429abc" becomes 429 (intended behavior)
            // We accept ALL valid HTTP codes here (not just retryable 429/502-504)
            // because isRetryableError() and classifyErrorType() need the code for accurate
            // error classification and logging, even for non-retryable errors.
            if (
              Number.isFinite(parsed) &&
              Number.isSafeInteger(parsed) &&
              parsed >= 100 &&
              parsed <= 599
            ) {
              lastExitCode = parsed;
              console.error(
                `[gh-issue] DEBUG Extracted HTTP status from error message (pattern: ${pattern.source}, exitCode: ${parsed})`
              );
              break;
            }
          }
        }

        // Log if no valid HTTP status code was extracted from error message
        if (lastExitCode === undefined) {
          // Check if error message suggests this SHOULD have had HTTP status
          const likelyHttpError = lastError.message.match(/\b(HTTP|status|429|502|503|504)\b/i);

          if (likelyHttpError) {
            // This looks like an HTTP error but we couldn't extract the status code
            console.error(
              `[gh-issue] WARN Failed to extract HTTP status code from error that appears HTTP-related (errorMessage: ${lastError.message}, matchedPattern: ${likelyHttpError[0]}, impact: Falling back to message pattern matching for retry logic, action: Update status extraction patterns or check for gh CLI version changes)`
            );
          } else {
            console.error(
              `[gh-issue] DEBUG No valid HTTP status code found in error message (errorMessage: ${lastError.message})`
            );
          }
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

      // Warn when error cannot be classified and we have no exit code
      // This indicates error message patterns may have changed or new error type encountered
      if (errorType === 'unknown' && lastExitCode === undefined) {
        console.error(
          `[gh-issue] WARN Error classification unknown and no exit code extracted (errorMessage: ${lastError.message}, command: gh ${args.join(' ')})`
        );
      }

      if (attempt === 1) {
        // Initial failure - log at INFO level since retry is designed to handle transient errors
        // This reduces noise in logs when first attempt fails but retry succeeds
        console.error(
          `[gh-issue] INFO ghCliWithRetry: initial attempt failed, will retry (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      } else {
        // Subsequent failures - log at WARN level
        console.error(
          `[gh-issue] WARN ghCliWithRetry: retry attempt failed, will retry again (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      }

      // Exponential backoff: 2^attempt seconds, capped at 60s
      // Examples: attempt 1->2s, 2->4s, 3->8s, 4->16s, 5->32s, 6+->60s (capped)
      // Rationale: Exponential backoff reduces load on GitHub API during outages and
      // gives transient issues more time to resolve with each retry.
      // Cap at 60s prevents impractical delays when maxRetries > 5.
      const MAX_DELAY_MS = 60000; // 60 seconds maximum delay
      const uncappedDelayMs = Math.pow(2, attempt) * 1000;
      const delayMs = Math.min(uncappedDelayMs, MAX_DELAY_MS);
      await sleep(delayMs);
    }
  }

  throw lastError || new Error('Unexpected retry failure');
}
