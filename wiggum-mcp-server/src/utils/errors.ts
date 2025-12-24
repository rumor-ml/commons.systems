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
  GitHubCliError,
  ParsingError,
  FormattingError,
  formatError,
  isTerminalError,
} from '@commons/mcp-common/errors';
import { createErrorResultFromError } from '@commons/mcp-common/result-builders';
import { createToolError } from '@commons/mcp-common/types';

// Re-export common errors for convenience
export {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  ParsingError,
  FormattingError,
  formatError,
  isTerminalError,
};

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
 * Create a standardized error result for MCP tool responses
 *
 * Delegates to the shared createErrorResultFromError for all common error types
 * including ParsingError and FormattingError (which are now in mcp-common).
 * Wiggum-specific error (GitError) is handled in the fallback.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolError with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolError {
  const commonResult = createErrorResultFromError(error);
  if (commonResult) return commonResult;

  // TODO: See issue #444 - Simplify error message extraction patterns
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = `Error: ${rawMessage}`;

  return createToolError(message, 'UnknownError', undefined);
}
