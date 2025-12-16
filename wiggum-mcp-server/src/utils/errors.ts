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
 * - McpError: Base class for all MCP-related errors (from mcp-common)
 *   - TimeoutError: Operation exceeded time limit (from mcp-common)
 *   - ValidationError: Invalid input parameters (from mcp-common)
 *   - NetworkError: Network-related failures (from mcp-common)
 *   - GitHubCliError: GitHub CLI command failures (wiggum-specific)
 *   - GitError: Git command failures (wiggum-specific)
 *   - ParsingError: Failed to parse external command output (wiggum-specific)
 *   - FormattingError: Failed to format response data (wiggum-specific)
 *
 * @module errors
 */

import type { ToolError } from '@commons/mcp-common/types';
import {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  formatError,
  isTerminalError,
} from '@commons/mcp-common/errors';

// Re-export common errors for convenience
export { McpError, TimeoutError, ValidationError, NetworkError, formatError, isTerminalError };

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
 * Extends the base createErrorResult from mcp-common to handle wiggum-specific errors:
 * - GitHubCliError: GitHub CLI command failures (may include exit code and stderr)
 * - GitError: Git command failures (may include exit code and stderr)
 * - ParsingError: Failed to parse external command output (version mismatch or breaking changes)
 * - FormattingError: Failed to format response data (protocol contract violation)
 *
 * For common errors (TimeoutError, ValidationError, NetworkError), this delegates
 * to the base implementation in mcp-common.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolError with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolError {
  const message = error instanceof Error ? error.message : String(error);
  let errorType = 'UnknownError';
  let errorCode: string | undefined;

  // Categorize wiggum-specific error types first
  if (error instanceof GitHubCliError) {
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
  } else if (error instanceof TimeoutError) {
    errorType = 'TimeoutError';
    errorCode = 'TIMEOUT';
  } else if (error instanceof ValidationError) {
    errorType = 'ValidationError';
    errorCode = 'VALIDATION_ERROR';
  } else if (error instanceof NetworkError) {
    errorType = 'NetworkError';
    errorCode = 'NETWORK_ERROR';
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
