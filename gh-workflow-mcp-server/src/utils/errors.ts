/**
 * Error handling utilities for GitHub Workflow MCP server
 */

import type { ToolError } from '@commons/mcp-common/types';
import {
  McpError,
  TimeoutError,
  ValidationError,
  GitHubCliError,
  formatError,
  isTerminalError,
} from '@commons/mcp-common/errors';
import { createErrorResultFromError } from '@commons/mcp-common/result-builders';

// Re-export common errors for convenience
export { McpError, TimeoutError, ValidationError, GitHubCliError, formatError, isTerminalError };

/**
 * Create a standardized error result for MCP tool responses
 *
 * Delegates to the shared createErrorResultFromError for all common error types.
 * Since this server only uses common errors (GitHubCliError, TimeoutError, etc.),
 * the shared helper handles everything.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolError with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolError {
  const commonResult = createErrorResultFromError(error);
  if (commonResult) return commonResult;

  // Fallback for unknown error types
  let message = String(error);
  if (error instanceof Error) {
    message = error.message;
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
      errorType: 'UnknownError',
      errorCode: undefined,
    },
  };
}
