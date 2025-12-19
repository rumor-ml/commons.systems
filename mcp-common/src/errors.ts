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
 * - stderr output (required)
 * - stdout output (optional)
 *
 * Note: Exit codes outside 0-255 are clamped to valid range with a warning
 * in the error message. This ensures error construction never fails.
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
 * ```
 */
export class GitHubCliError extends McpError {
  public readonly exitCode: number;

  constructor(
    message: string,
    exitCode: number,
    public readonly stderr: string,
    public readonly stdout?: string
  ) {
    // Clamp exit code to valid range instead of throwing
    const clampedExitCode = Math.max(0, Math.min(255, exitCode));

    // Add warning to message if exit code was invalid
    const warningPrefix =
      exitCode !== clampedExitCode
        ? `[Warning: Invalid exit code ${exitCode} clamped to ${clampedExitCode}] `
        : '';

    super(`${warningPrefix}${message}`, 'GH_CLI_ERROR');
    this.name = 'GitHubCliError';
    this.exitCode = clampedExitCode;
  }
}

/**
 * Determine if an error is terminal (not retryable)
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
 * IMPORTANT: This function currently ONLY returns true for ValidationError.
 * All other error types (including unknown errors, null, strings, etc.) return false.
 *
 * @param error - Error to check
 * @returns true if error is terminal and should not be retried
 */
export function isTerminalError(error: unknown): boolean {
  const isTerminal = error instanceof ValidationError;

  // Log retry decisions for visibility
  if (error instanceof Error && !isTerminal) {
    console.debug('[mcp-common] Error marked as retryable:', {
      type: error.constructor.name,
      message: error.message.substring(0, 100),
      isKnownType: error instanceof McpError,
    });
  }

  return isTerminal;
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
    console.warn('[mcp-common] Error object has non-string code:', {
      code: errorCode,
      type: typeof errorCode,
    });
    return false;
  }

  return SYSTEM_ERROR_CODES.includes(errorCode as any);
}
