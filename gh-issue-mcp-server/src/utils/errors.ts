/**
 * Error handling utilities for GitHub Issue MCP server
 *
 * This module provides a typed error hierarchy for categorizing failures in MCP tool operations.
 * Error classes enable:
 * - Type-safe error handling with instanceof checks
 * - Structured error categorization for retry logic
 * - Standardized error result formatting for MCP protocol
 *
 * Error Hierarchy:
 * - McpError: Base class for all MCP-related errors
 *   - TimeoutError: Operation exceeded time limit (may be retryable)
 *   - ValidationError: Invalid input parameters (terminal, not retryable)
 *   - NetworkError: Network-related failures (may be retryable)
 *   - GitHubCliError: GitHub CLI command failures
 *   - ParsingError: Failed to parse external command output
 *   - FormattingError: Failed to format response data
 *
 * @module errors
 */

import type { ErrorResult } from '../types.js';

/**
 * Base error class for all MCP-related errors
 *
 * Provides optional error code for categorization and extends standard Error
 * with MCP-specific context. All GitHub Issue MCP errors should extend this class.
 */
export class McpError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/**
 * Error thrown when an operation exceeds its time limit
 *
 * Used for polling operations, async waits, or long-running commands that
 * exceed configured timeout thresholds. **Retryable** with increased timeout
 * or after confirming external service is responsive.
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
 * Indicates connectivity issues, DNS resolution failures, or network timeouts.
 * **Retryable** after brief delay or after confirming network connectivity.
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
 * Captures exit code, stderr output, and optional cause for detailed
 * debugging of gh command failures. Common for API errors, auth issues,
 * or invalid gh command parameters.
 */
export class GitHubCliError extends McpError {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
    public readonly cause?: Error
  ) {
    super(message, 'GH_CLI_ERROR');
    this.name = 'GitHubCliError';
  }
}

/**
 * Error thrown when parsing external command output fails
 *
 * Indicates unexpected format or structure in command output (e.g., JSON
 * parsing failures, malformed responses). Usually indicates version mismatch
 * or breaking changes in external tools.
 */
export class ParsingError extends McpError {
  constructor(message: string) {
    super(message, 'PARSING_ERROR');
    this.name = 'ParsingError';
  }
}

/**
 * Error thrown when formatting response data fails
 *
 * Indicates invalid response structure that doesn't match expected schema.
 * Common when internal state or protocol contracts are violated.
 */
export class FormattingError extends McpError {
  constructor(message: string) {
    super(message, 'FORMATTING_ERROR');
    this.name = 'FormattingError';
  }
}

/**
 * Create a standardized error result for MCP tool responses
 *
 * Categorizes errors by type to help consumers handle different error scenarios:
 * - TimeoutError: Operation exceeded time limit (may be retryable)
 * - ValidationError: Invalid input parameters (terminal, not retryable)
 * - NetworkError: Network-related failures (may be retryable)
 * - GitHubCliError: GitHub CLI command failures (may include exit code and stderr)
 * - ParsingError: Failed to parse external command output (version mismatch or breaking changes)
 * - FormattingError: Failed to format response data (protocol contract violation)
 * - McpError: Generic MCP-related errors (base class for all custom errors)
 * - Generic errors: Unexpected failures (non-MCP errors, programming bugs, or unknown types)
 *   Examples: TypeError, ReferenceError, third-party library errors
 *
 * This function acts as a protocol bridge, converting TypeScript Error objects
 * into MCP-compliant ErrorResult format with structured metadata for error
 * categorization and retry logic.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ErrorResult with error information and type metadata
 *   - For GitHubCliError: Includes stderr output and exitCode in _meta when available
 *   - For all errors: Includes errorType and errorCode for categorization
 */
export function createErrorResult(error: unknown): ErrorResult {
  const message = error instanceof Error ? error.message : String(error);
  let errorType = 'UnknownError';
  let errorCode: string | undefined;

  // Categorize error types for better handling
  if (error instanceof TimeoutError) {
    errorType = 'TimeoutError';
    errorCode = 'TIMEOUT';
  } else if (error instanceof ValidationError) {
    errorType = 'ValidationError';
    errorCode = 'VALIDATION_ERROR';
  } else if (error instanceof NetworkError) {
    errorType = 'NetworkError';
    errorCode = 'NETWORK_ERROR';
  } else if (error instanceof GitHubCliError) {
    errorType = 'GitHubCliError';
    errorCode = 'GH_CLI_ERROR';
  } else if (error instanceof ParsingError) {
    errorType = 'ParsingError';
    errorCode = 'PARSING_ERROR';
  } else if (error instanceof FormattingError) {
    errorType = 'FormattingError';
    errorCode = 'FORMATTING_ERROR';
  } else if (error instanceof McpError) {
    errorType = 'McpError';
    errorCode = error.code;
  }

  return {
    content: [
      {
        type: 'text',
        text: `Error: ${message}`,
      },
    ],
    isError: true,
    _meta: {
      errorType,
      errorCode,
    },
  };
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Determine if an error is terminal (not retryable)
 *
 * Retry Strategy:
 * - ValidationError: Always terminal (requires user input correction)
 * - FormattingError: Always terminal (internal protocol violation)
 * - TimeoutError: Potentially retryable (operation may succeed with more time)
 * - NetworkError: Potentially retryable (transient connectivity issues)
 * - GitHubCliError: Currently treated as potentially retryable (see note below)
 * - Other errors: Treated as potentially retryable (conservative approach)
 *
 * NOTE: GitHubCliError instances are currently treated as retryable regardless
 * of exit code. This is a known limitation - permanent failures like 401/403/404
 * will be retried. See issue #391 for exit code-based classification.
 *
 * @param error - Error to check
 * @returns true if error is terminal and should not be retried
 */
export function isTerminalError(error: unknown): boolean {
  // Validation and formatting errors are always terminal
  // Network, timeout, and other errors may be retryable
  return error instanceof ValidationError || error instanceof FormattingError;
}
