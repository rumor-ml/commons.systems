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
 *   - GitHubCliError: GitHub CLI command failures (from mcp-common)
 *   - GitError: Git command failures (wiggum-specific)
 *   - ParsingError: Failed to parse external command output (from mcp-common)
 *   - FormattingError: Failed to format response data (from mcp-common)
 *
 * @module errors
 */

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
import { createErrorResult } from '@commons/mcp-common/result-builders';

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
  createErrorResult,
};

/**
 * Error thrown when git commands fail (wiggum-specific)
 *
 * Captures exit code and stderr output for debugging git operation failures.
 * Common for merge conflicts, permission issues, or invalid git state.
 *
 * Note: This extends McpError, so it's automatically handled by createErrorResult()
 * from mcp-common (falls through to the McpError base case).
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
