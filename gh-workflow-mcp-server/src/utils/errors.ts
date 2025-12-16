/**
 * Error handling utilities for GitHub Workflow MCP server
 */

import type { ToolError } from '@commons/mcp-common/types';
import {
  McpError,
  TimeoutError,
  ValidationError,
  formatError,
  isTerminalError,
} from '@commons/mcp-common/errors';

// Re-export common errors for convenience
export { McpError, TimeoutError, ValidationError, formatError, isTerminalError };

// GitHub-specific error classes
export class GitHubCliError extends McpError {
  constructor(
    message: string,
    public readonly exitCode: number, // Required
    public readonly stderr: string,   // Required
    public readonly stdout?: string   // Optional
  ) {
    if (exitCode < 0 || exitCode > 255) {
      throw new Error(`Invalid exit code: ${exitCode}`);
    }
    super(message, 'GH_CLI_ERROR');
    this.name = 'GitHubCliError';
  }
}

/**
 * Create a standardized error result for MCP tool responses
 *
 * Extends the base createErrorResult from mcp-common to handle GitHub-specific errors:
 * - GitHubCliError: GitHub CLI command failed
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolError with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolError {
  const message = error instanceof Error ? error.message : String(error);
  let errorType = 'UnknownError';
  let errorCode: string | undefined;

  // Categorize error types
  if (error instanceof GitHubCliError) {
    errorType = 'GitHubCliError';
    errorCode = 'GH_CLI_ERROR';
  } else if (error instanceof TimeoutError) {
    errorType = 'TimeoutError';
    errorCode = 'TIMEOUT';
  } else if (error instanceof ValidationError) {
    errorType = 'ValidationError';
    errorCode = 'VALIDATION_ERROR';
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
