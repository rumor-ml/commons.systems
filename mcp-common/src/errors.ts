/**
 * Shared error classes for MCP servers
 *
 * This module provides a typed error hierarchy for categorizing failures in MCP tool operations.
 * Error classes enable:
 * - Type-safe error handling with instanceof checks
 * - Structured error categorization for retry logic
 * - Standardized error codes across all MCP servers
 *
 * Error Hierarchy:
 * - McpError: Base class for all MCP-related errors
 *   - TimeoutError: Operation exceeded time limit (may be retryable)
 *   - ValidationError: Invalid input parameters (terminal, not retryable)
 *   - NetworkError: Network-related failures (may be retryable)
 *
 * @module errors
 */

/**
 * Type-safe error codes used across all MCP servers
 */
export type ErrorCode =
  | 'TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'GH_CLI_ERROR'
  | 'GIT_ERROR'
  | 'PARSING_ERROR'
  | 'FORMATTING_ERROR'
  | 'SCRIPT_EXECUTION_ERROR'
  | 'INFRASTRUCTURE_ERROR'
  | 'TEST_OUTPUT_PARSE_ERROR';

/**
 * Base error class for all MCP-related errors
 *
 * Provides optional error code for categorization and extends standard Error
 * with MCP-specific context. All MCP errors should extend this class.
 */
export class McpError extends Error {
  constructor(
    message: string,
    public readonly code?: ErrorCode
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/**
 * Error thrown when an operation exceeds its time limit
 *
 * Used for polling operations, async waits, or long-running commands that
 * exceed configured timeout thresholds. May be retryable depending on context.
 */
export class TimeoutError extends McpError {
  constructor(message: string) {
    super(message, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when input parameters fail validation
 *
 * Indicates malformed or invalid input data. These errors are terminal
 * (not retryable) as they require user correction of input parameters.
 */
export class ValidationError extends McpError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown for network-related failures
 *
 * Covers HTTP requests, API calls, or other network operations that fail
 * due to connectivity issues, timeouts, or server errors. May be retryable.
 */
export class NetworkError extends McpError {
  constructor(message: string) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

/**
 * Error thrown when GitHub CLI (gh) commands fail
 *
 * Captures structured information from gh command failures including:
 * - Exit code (clamped to valid range 0-255)
 * - stderr output (can be empty string)
 * - stdout output (optional)
 *
 * Note: Exit codes outside 0-255 are clamped to valid range (0-255) with a warning
 * in the error message, EXCEPT -1 which is preserved as a sentinel value indicating
 * "exit code unknown". This ensures error construction never fails.
 *
 * @example
 * ```typescript
 * // When a gh command fails, capture the error details:
 * throw new GitHubCliError(
 *   'Failed to create PR',
 *   1,
 *   'Error: could not create pull request',
 *   ''
 * );
 *
 * // Invalid exit code is clamped with warning prefix:
 * const err = new GitHubCliError('Failed', 500, 'stderr');
 * // err.message === '[Warning: Invalid exit code 500 clamped to 255] Failed'
 * // err.exitCode === 255
 * ```
 */
export class GitHubCliError extends McpError {
  public readonly exitCode: number;

  constructor(
    message: string,
    exitCode: number = -1,
    public readonly stderr: string = '',
    public readonly stdout?: string,
    cause?: Error
  ) {
    // -1 indicates process didn't run or exit code unknown
    // Clamp exit code to valid range (0-255) for actual exit codes
    const clampedExitCode = exitCode === -1 ? -1 : Math.max(0, Math.min(255, exitCode));

    // Add warning to message if exit code was invalid (but not for -1 sentinel)
    const warningPrefix =
      exitCode !== -1 && exitCode !== clampedExitCode
        ? `[Warning: Invalid exit code ${exitCode} clamped to ${clampedExitCode}] `
        : '';

    super(`${warningPrefix}${message}`, 'GH_CLI_ERROR');
    this.name = 'GitHubCliError';
    this.exitCode = clampedExitCode;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Retry decision information with structured metadata
 *
 * Provides detailed information about whether an error should be retried,
 * including the error type and reason for the retry decision.
 */
export interface RetryDecision {
  /** Whether the error is terminal (should not be retried) */
  readonly isTerminal: boolean;
  /** The error type (e.g., 'ValidationError', 'TimeoutError', 'Error', 'string') */
  readonly errorType: string;
  /** Human-readable explanation of why the error is or is not terminal */
  readonly reason: string;
}

/**
 * Analyze an error to determine if it should be retried
 *
 * Returns structured metadata about the retry decision including:
 * - Whether the error is terminal
 * - The error type
 * - The reason for the decision
 *
 * Retry Strategy:
 * - ValidationError: Terminal (requires user input correction)
 * - TimeoutError: Potentially retryable (may succeed with more time)
 * - NetworkError: Potentially retryable (transient network issues)
 * - Other errors: Treated as potentially retryable (conservative approach)
 *
 * Conservative Default Rationale:
 * Unknown errors are assumed retryable because:
 * 1. Many infrastructure failures (DB locks, rate limits, transient service issues) are temporary
 * 2. Retrying maximizes system resilience without user intervention
 * 3. Retry limits (maxRetries) prevent infinite loops
 * 4. Only ValidationError is definitively terminal (bad input won't become valid via retry)
 * This errs on the side of availability over failing fast.
 *
 * Trade-offs:
 * - Pro: Automatic recovery from transient failures (network blips, DB contention)
 * - Con: May mask systemic issues that need immediate attention
 * - Con: Adds latency if retries are unsuccessful
 * Servers can override this behavior by checking specific error types before retrying.
 *
 * @param error - Error to analyze
 * @returns Structured retry decision with metadata
 *
 * @example
 * ```typescript
 * const decision = analyzeRetryability(error);
 * if (decision.isTerminal) {
 *   console.error(`Terminal error: ${decision.reason}`);
 *   return createErrorResult(error);
 * }
 * console.log(`Retrying: ${decision.reason}`);
 * await retry(operation);
 * ```
 */
export function analyzeRetryability(error: unknown): RetryDecision {
  // ValidationError is terminal - requires user input correction
  if (error instanceof ValidationError) {
    return {
      isTerminal: true,
      errorType: 'ValidationError',
      reason: 'Invalid input requires user correction',
    };
  }

  // All other error types are retryable by default (conservative approach)
  if (error instanceof Error) {
    const errorType = error.constructor.name;
    const isKnownType = error instanceof McpError;

    if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
      console.debug('[mcp-common] Error marked as retryable:', {
        type: errorType,
        message: error.message.substring(0, 100),
        isKnownType,
      });
    }

    return {
      isTerminal: false,
      errorType,
      reason: isKnownType
        ? `${errorType} may be transient, retry may succeed`
        : 'Unknown error type treated as retryable (conservative default)',
    };
  }

  // Non-Error objects (strings, numbers, etc.)
  const errorType = typeof error;
  return {
    isTerminal: false,
    errorType,
    reason: `Non-Error object (${errorType}) treated as retryable`,
  };
}

/**
 * Determine if an error is terminal (not retryable)
 *
 * This is a convenience wrapper around analyzeRetryability() that returns
 * only the boolean terminal status. For detailed retry decision information,
 * use analyzeRetryability() instead.
 *
 * Retry Strategy:
 * - ValidationError: Terminal (requires user input correction)
 * - TimeoutError: Potentially retryable (may succeed with more time)
 * - NetworkError: Potentially retryable (transient network issues)
 * - Other errors: Treated as potentially retryable (conservative approach)
 *
 * IMPORTANT: This function currently ONLY returns true for ValidationError.
 * All other error types (including unknown errors, null, strings, etc.) return false.
 *
 * @param error - Error to check
 * @returns true if error is terminal and should not be retried
 *
 * @see analyzeRetryability For detailed retry decision information
 */
export function isTerminalError(error: unknown): boolean {
  return analyzeRetryability(error).isTerminal;
}

/**
 * Format an error for display with optional context
 *
 * Formats errors with type information and optional stack traces for debugging.
 * For McpError instances, includes error code if present.
 *
 * @param error - Error to format
 * @param includeStack - Whether to include stack trace (default: false)
 * @returns Formatted error message string
 */
export function formatError(error: unknown, includeStack = false): string {
  if (error instanceof McpError) {
    const parts = [`[${error.name}]`, error.code ? `(${error.code})` : '', error.message];

    if (includeStack && error.stack) {
      parts.push(`\nStack: ${error.stack}`);
    }

    return parts.filter(Boolean).join(' ');
  }

  if (error instanceof Error) {
    const formatted = `[${error.name}] ${error.message}`;
    return includeStack && error.stack ? `${formatted}\nStack: ${error.stack}` : formatted;
  }

  return String(error);
}

/**
 * System error codes that should be re-thrown without wrapping
 *
 * These errors indicate critical system failures that applications
 * cannot recover from and should propagate to the caller.
 */
export const SYSTEM_ERROR_CODES = [
  'ENOMEM', // Out of memory
  'ENOSPC', // No space left on device
  'EMFILE', // Too many open files (process limit)
  'ENFILE', // Too many open files (system limit)
] as const;

/**
 * Check if an error is a system-level error that should not be wrapped
 *
 * @param error - Error to check
 * @returns true if error is a system error
 */
export function isSystemError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  // Only check errors that have a string code property
  const errorCode = (error as { code: unknown }).code;

  if (typeof errorCode !== 'string') {
    const warningMessage = '[mcp-common] Error object has non-string code';
    console.warn(warningMessage, {
      code: errorCode,
      type: typeof errorCode,
    });

    // In development mode, provide additional diagnostic information
    if (process.env.NODE_ENV === 'development') {
      console.warn(`${warningMessage} - Full error object:`, error);
    }

    return false;
  }

  return SYSTEM_ERROR_CODES.includes(errorCode as any);
}
