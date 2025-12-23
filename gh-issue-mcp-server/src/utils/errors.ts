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

import type { ToolError } from '@commons/mcp-common/types';
import {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  formatError,
  isTerminalError,
} from '@commons/mcp-common/errors';
import { createErrorResultFromError } from '@commons/mcp-common/result-builders';

// Re-export common errors for convenience
export {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  formatError,
  isTerminalError,
};

/**
 * Error thrown when parsing external command output fails
 *
 * Indicates unexpected format or structure in command output (e.g., JSON
 * parsing failures, malformed responses). Usually indicates version mismatch
 * or breaking changes in external tools.
 */
// TODO: See issue #459 - Add cause parameter to preserve error chains
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
// TODO: See issue #459 - Add cause parameter to preserve error chains
export class FormattingError extends McpError {
  constructor(message: string) {
    super(message, 'FORMATTING_ERROR');
    this.name = 'FormattingError';
  }
}

/**
 * Create a standardized error result for MCP tool responses
 *
 * Delegates to the shared createErrorResultFromError for all common error types.
 * Server-specific errors (ParsingError, FormattingError) are handled by
 * createErrorResultFromError as generic McpError with their error codes.
 * Only non-McpError types fall through to the UnknownError fallback.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolError with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolError {
  const commonResult = createErrorResultFromError(error);
  if (commonResult) return commonResult;

  // Fallback for unknown error types
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: 'text',
        text: `Error: ${message}`,
      },
    ],
    isError: true,
    _meta: {
      errorType: 'UnknownError',
      errorCode: undefined,
    },
  };
}
