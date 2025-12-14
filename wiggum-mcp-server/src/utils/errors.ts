/**
 * Error handling utilities for Wiggum MCP server
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
 *   - GitError: Git command failures
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
 * with MCP-specific context. All wiggum MCP errors should extend this class.
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
 * Error thrown when git commands fail
 *
 * Captures exit code and stderr output for debugging git operation failures.
 * Common for merge conflicts, permission issues, or invalid git state.
 */
export class GitError extends McpError {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message, 'GIT_ERROR');
    this.name = 'GitError';
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
 * - TimeoutError: Operation exceeded time limit
 * - ValidationError: Invalid input parameters
 * - NetworkError: Network-related failures
 * - Generic errors: Unexpected failures
 *
 * This function acts as a protocol bridge, converting TypeScript Error objects
 * into MCP-compliant ErrorResult format with structured metadata for error
 * categorization and retry logic.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ErrorResult with error information and type metadata
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
  } else if (error instanceof GitError) {
    errorType = 'GitError';
    errorCode = 'GIT_ERROR';
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
 * - ValidationError: Terminal (requires user input correction)
 * - TimeoutError: Potentially retryable (may succeed with more time)
 * - NetworkError: Potentially retryable (transient network issues)
 * - Other errors: Treated as potentially retryable (conservative approach)
 *
 * @param error - Error to check
 * @returns true if error is terminal and should not be retried
 */
export function isTerminalError(error: unknown): boolean {
  // Validation errors are always terminal (bad input)
  // Network and timeout errors may be retryable
  return error instanceof ValidationError;
}
