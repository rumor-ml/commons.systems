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
 *   - StateDetectionError: State detection failed (recursion limit, rapid changes)
 *   - StateApiError: GitHub API failures during state operations
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
  isTerminalError as baseIsTerminalError,
} from '@commons/mcp-common/errors';
import { createErrorResult as baseCreateErrorResult } from '@commons/mcp-common/result-builders';
import type { ToolError } from '@commons/mcp-common/types';
import { createToolError } from '@commons/mcp-common/types';

export {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  ParsingError,
  FormattingError,
  formatError,
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

/**
 * Error thrown when state detection fails
 *
 * Indicates that the workflow state could not be reliably determined, typically
 * due to rapid PR state changes exceeding recursion limits or other detection
 * failures. This is a terminal error requiring manual intervention.
 */
export class StateDetectionError extends McpError {
  constructor(
    message: string,
    public readonly context?: {
      depth?: number;
      maxDepth?: number;
      previousState?: string;
      newState?: string;
      [key: string]: unknown;
    }
  ) {
    super(message, 'STATE_DETECTION_ERROR');
    this.name = 'StateDetectionError';
  }
}

/**
 * Error thrown when GitHub API operations fail during state management
 *
 * Wraps GitHub API errors (auth, rate limit, network, etc.) with context about
 * the specific state operation that failed. Use this for failures during state
 * reads/writes rather than generic GitHubCliError.
 *
 * @throws {ValidationError} If resourceId is provided but is not a positive integer
 */
export class StateApiError extends McpError {
  constructor(
    message: string,
    public readonly operation: 'read' | 'write',
    public readonly resourceType: 'pr' | 'issue',
    public readonly resourceId?: number,
    public readonly cause?: Error
  ) {
    // Validate resourceId if provided - must be positive integer (valid PR/issue number)
    if (resourceId !== undefined && (!Number.isInteger(resourceId) || resourceId <= 0)) {
      throw new ValidationError(
        `StateApiError: resourceId must be a positive integer, got: ${resourceId}`
      );
    }
    super(message, 'STATE_API_ERROR');
    this.name = 'StateApiError';
  }
}

/**
 * Determine if an error is terminal (not retryable)
 *
 * Retry Strategy:
 * - ValidationError: Terminal (requires user input correction)
 * - StateDetectionError: Terminal (workflow state unreliable, requires manual intervention)
 * - TimeoutError: Potentially retryable (may succeed with more time)
 * - NetworkError: Potentially retryable (transient network issues)
 * - StateApiError: Potentially retryable (may be transient API failure)
 * - Other errors: Treated as potentially retryable (conservative approach)
 *
 * NOTE: Unlike gh-workflow/gh-issue MCP servers, this implementation does NOT
 * treat FormattingError as terminal. This is intentional - wiggum's error handling
 * prefers conservative retry behavior for internal errors to maximize workflow completion.
 *
 * @param error - Error to check
 * @returns true if error is terminal and should not be retried
 */
export function isTerminalError(error: unknown): boolean {
  // First check base terminal errors (ValidationError, FormattingError from mcp-common)
  // But for wiggum, we override FormattingError to be retryable
  if (error instanceof FormattingError) {
    return false; // Wiggum treats FormattingError as retryable
  }

  // StateDetectionError is always terminal
  if (error instanceof StateDetectionError) {
    return true;
  }

  // Delegate to base implementation for other error types
  return baseIsTerminalError(error);
}

/**
 * Create a standardized error result for MCP tool responses
 *
 * This wiggum-specific wrapper handles StateDetectionError and StateApiError
 * before delegating to the mcp-common createErrorResult for other error types.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolError with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolError {
  // Handle wiggum-specific error types first
  if (error instanceof StateDetectionError) {
    return createToolError(
      `Error: ${error.message}`,
      'StateDetectionError',
      'STATE_DETECTION_ERROR'
    );
  }

  if (error instanceof StateApiError) {
    return createToolError(`Error: ${error.message}`, 'StateApiError', 'STATE_API_ERROR');
  }

  // Delegate to mcp-common for all other error types
  return baseCreateErrorResult(error);
}
