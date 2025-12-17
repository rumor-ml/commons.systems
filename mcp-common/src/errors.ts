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
 */
export class GitHubCliError extends McpError {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly stdout?: string
  ) {
    if (exitCode < 0 || exitCode > 255) {
      throw new Error(`Invalid exit code: ${exitCode}`);
    }
    super(message, 'GH_CLI_ERROR');
    this.name = 'GitHubCliError';
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
 * @param error - Error to check
 * @returns true if error is terminal and should not be retried
 */
export function isTerminalError(error: unknown): boolean {
  // Validation errors are always terminal (bad input)
  // Network and timeout errors may be retryable
  return error instanceof ValidationError;
}

/**
 * Format an error for display
 *
 * @param error - Error to format
 * @returns Formatted error message string
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
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
  'ENOMEM',   // Out of memory
  'ENOSPC',   // No space left on device
  'EMFILE',   // Too many open files (process limit)
  'ENFILE',   // Too many open files (system limit)
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
  const errorCode = String((error as any).code);
  return SYSTEM_ERROR_CODES.includes(errorCode as any);
}
