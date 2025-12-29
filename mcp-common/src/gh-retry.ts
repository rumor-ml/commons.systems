/**
 * GitHub CLI retry logic shared across MCP servers
 *
 * Provides retry mechanisms for transient GitHub API failures with exponential backoff.
 * Can be injected with different ghCli implementations across servers.
 */

import type { GitHubCliError } from './errors.js';

/**
 * Options for GitHub CLI execution
 */
export interface GhCliWithRetryOptions {
  repo?: string;
  timeout?: number;
  cwd?: string;
}

/**
 * Function signature for executing GitHub CLI commands
 */
export type GhCliFn = (args: string[], options?: GhCliWithRetryOptions) => Promise<string>;

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
 * Determines if an error should be retried using multiple detection methods:
 * 1. Exit code (most reliable when available) - checks for HTTP codes 429, 502-504
 * 2. Node.js error.code (stable API) - checks for network error codes (ECONNRESET, etc.)
 * 3. Message pattern matching (least reliable) - checks error message text
 * All three methods are checked; if ANY indicate retryable error, returns true.
 *
 * Current limitation: gh CLI wraps errors in generic Error objects, losing HTTP
 * status codes and error types. We must parse error messages, which are fragile
 * to GitHub CLI updates. See issue #453 for migration to structured error types.
 *
 * @param error - Error to check for retryability
 * @param exitCode - Optional exit code from the CLI command
 * @returns true if error should be retried, false otherwise
 */
// TODO(#453): Migrate to structured error types for type-safe error handling
// Current blocker: gh CLI wraps errors in generic Error objects, losing type information.
// We must rely on exitCode parameter and message pattern matching until gh CLI preserves error types.
// When fixed: Replace pattern matching with `instanceof NetworkError`, `instanceof RateLimitError`, etc.
// Benefits: Type-safe error handling, eliminate fragile message parsing
function isRetryableError(error: unknown, exitCode?: number): boolean {
  // Priority 1: Exit code (most reliable when available)
  // Note: gh CLI sometimes uses HTTP status codes as process exit codes (e.g., exit code 429 for rate limit).
  // This is not guaranteed across all gh CLI versions or error types - Unix convention is exit codes 0-255,
  // but gh CLI may use HTTP codes (100-599) for some API errors.
  // We check exitCode first when available, then fall back to message parsing (lines 258-307).
  if (exitCode !== undefined) {
    if ([429, 502, 503, 504].includes(exitCode)) {
      return true;
    }
  }

  if (error instanceof Error) {
    // Priority 2: Node.js error codes (stable API, but less specific than exit codes)
    // These indicate low-level network/system errors that are usually retryable
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code && RETRYABLE_ERROR_CODES.includes(nodeError.code)) {
      return true;
    }

    // Priority 3: Message pattern matching (fallback, less reliable)
    // FRAGILE: gh CLI error message format is not a stable API and can change between versions
    // If patterns stop matching, check:
    //   1. gh CLI release notes for error message changes
    //   2. Whether gh CLI now exposes structured error types (see issue #453)
    //   3. Add new patterns based on observed error messages in logs
    // Long-term fix: Migrate to structured error types (issue #453)
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
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute gh CLI command with retry logic
 *
 * Retries gh CLI commands for transient errors (network issues, timeouts, 5xx errors, rate limits).
 * Uses exponential backoff (2s, 4s, 8s). Logs retry attempts and final failures.
 * Non-retryable errors (like validation errors) fail immediately.
 *
 * @param ghCli - Function to execute gh commands
 * @param args - GitHub CLI command arguments
 * @param options - Optional execution options
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns The stdout from the gh command
 * @throws {Error} When all retry attempts are exhausted or error is non-retryable
 *
 * @example
 * ```typescript
 * import { ghCliWithRetry } from '@commons/mcp-common/gh-retry';
 * const result = await ghCliWithRetry(ghCli, ['pr', 'view', '123'], {}, 5);
 * ```
 */
export async function ghCliWithRetry(
  ghCli: GhCliFn,
  args: string[],
  options?: GhCliWithRetryOptions,
  maxRetries = 3
): Promise<string> {
  // Validate maxRetries to ensure loop executes at least once and doesn't cause excessive delays
  // Prevents edge cases:
  //   - maxRetries < 1: Would skip the loop entirely
  //   - maxRetries > 100: Would cause excessive delays (with 60s cap, could be up to 100 minutes)
  //   - Non-integer (0.5, NaN, Infinity): Fractional retries or infinite loops
  // Without this validation, the function would reach the unreachable code path at the end
  // and throw an internal error with no context about the actual cause.
  const MAX_RETRIES_LIMIT = 100;
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > MAX_RETRIES_LIMIT) {
    const GitHubCliError = (await import('./errors.js')).GitHubCliError;
    throw new GitHubCliError(
      `ghCliWithRetry: maxRetries must be a positive integer between 1 and ${MAX_RETRIES_LIMIT}, ` +
        `got: ${maxRetries} (type: ${typeof maxRetries}). ` +
        `Common values: 3 (default), 5 (flaky operations), 10 (very flaky). ` +
        `Values > 10 may indicate excessive retry tolerance that masks systemic issues. ` +
        `Command: gh ${args.join(' ')}`
    );
  }

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
          `[mcp-common] WARN ghCliWithRetry: succeeded after retry - transient failure recovered (attempt ${attempt}/${maxRetries}, errorType: ${classifyErrorType(firstError, firstExitCode)}, command: gh ${args.join(' ')}, impact: Operation delayed by retry, action: Monitor for consistent retry patterns)`
        );
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Attempt to extract exit code from error object (duck-typed - works for GitHubCliError and similar types)
      // Note: exitCode may be undefined if:
      //   - Error object doesn't have exitCode property (e.g., generic Error, network timeout)
      //   - gh CLI exited without setting HTTP status (e.g., subprocess crash)
      //   - Error originated from ghCli() wrapper before CLI invocation
      lastExitCode = (error as { exitCode?: number }).exitCode;
      // Fallback: If exitCode unavailable, parse HTTP status from error message using multiple patterns
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
            // Validate parsed exit code is a valid HTTP status code
            // - Must be finite (not Infinity or NaN from malformed input)
            // - Must be safe integer (no precision loss)
            // - Must be in valid HTTP status range (100-599)
            if (
              Number.isFinite(parsed) &&
              Number.isSafeInteger(parsed) &&
              parsed >= 100 &&
              parsed <= 599
            ) {
              lastExitCode = parsed;
              console.error(
                `[mcp-common] DEBUG Extracted HTTP status from error message (pattern: ${pattern.source}, exitCode: ${parsed})`
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
              `[mcp-common] WARN Failed to extract HTTP status code from error that appears HTTP-related (errorMessage: ${lastError.message}, matchedPattern: ${likelyHttpError[0]}, impact: Falling back to message pattern matching for retry logic, action: Update status extraction patterns or check for gh CLI version changes)`
            );
          } else {
            console.error(
              `[mcp-common] DEBUG No valid HTTP status code found in error message (errorMessage: ${lastError.message})`
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
        // Note: Error context already logged to stderr in the console.error call below
        console.error(
          `[mcp-common] ghCliWithRetry: non-retryable error encountered (attempt ${attempt}/${maxRetries}, errorType: ${classifyErrorType(lastError, lastExitCode)}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')})`
        );
        throw lastError;
      }

      if (attempt === maxRetries) {
        // Final attempt failed - log all attempts exhausted with full context
        console.error(
          `[mcp-common] ghCliWithRetry: all attempts failed (maxRetries: ${maxRetries}, errorType: ${classifyErrorType(lastError, lastExitCode)}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
        throw lastError;
      }

      // Log retry attempts with consistent formatting and full context
      const errorType = classifyErrorType(lastError, lastExitCode);

      // Warn when error cannot be classified and we have no exit code
      // This indicates error message patterns may have changed or new error type encountered
      if (errorType === 'unknown' && lastExitCode === undefined) {
        console.error(
          `[mcp-common] WARN Error classification unknown and no exit code extracted (errorMessage: ${lastError.message}, command: gh ${args.join(' ')})`
        );
      }

      if (attempt === 1) {
        // Initial failure - log at INFO level since retry is designed to handle transient errors
        // This reduces noise in logs when first attempt fails but retry succeeds
        console.error(
          `[mcp-common] INFO ghCliWithRetry: initial attempt failed, will retry (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      } else {
        // Subsequent failures - WARN level to indicate multiple failures
        console.error(
          `[mcp-common] WARN ghCliWithRetry: retry attempt failed, will retry again (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      }

      // Exponential backoff: 2^attempt * 1000ms, capped at 60s
      // Examples: attempt 1->2s, 2->4s, 3->8s, 4->16s, 5->32s, 6->60s (capped)
      // Rationale: Reduces API load during outages, gives transient issues time to resolve
      // Cap at 60s prevents impractical delays for high maxRetries values
      const MAX_DELAY_MS = 60000; // 60 seconds maximum delay
      const uncappedDelayMs = Math.pow(2, attempt) * 1000;
      const delayMs = Math.min(uncappedDelayMs, MAX_DELAY_MS);
      await sleep(delayMs);
    }
  }

  // UNREACHABLE: Loop must execute at least once (maxRetries validated at entry, lines 210-227)
  // and every iteration either returns success or throws. If reached, this indicates a logic bug.
  // Provide full diagnostic context for debugging.
  const GitHubCliError = (await import('./errors.js')).GitHubCliError;
  console.error(
    `[mcp-common] ERROR INTERNAL: ghCliWithRetry loop completed without returning (maxRetries: ${maxRetries}, lastExitCode: ${lastExitCode}, command: gh ${args.join(' ')}, lastError: ${lastError?.message ?? 'none'})`
  );
  throw (
    lastError ||
    new GitHubCliError(
      `INTERNAL ERROR: ghCliWithRetry loop completed without returning. ` +
        `This indicates a programming error in retry logic. ` +
        `Command: gh ${args.join(' ')}, maxRetries: ${maxRetries}, ` +
        `lastError: none, lastExitCode: ${lastExitCode ?? 'undefined'}`
    )
  );
}
