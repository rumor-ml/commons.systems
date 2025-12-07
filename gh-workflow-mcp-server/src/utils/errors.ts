/**
 * Error handling utilities for GitHub Workflow MCP server
 */

import type { ToolResult } from '../types.js';

export class McpError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export class GitHubCliError extends McpError {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message, 'GH_CLI_ERROR');
    this.name = 'GitHubCliError';
  }
}

export class TimeoutError extends McpError {
  constructor(message: string) {
    super(message, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends McpError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Create a standardized error result for MCP tool responses
 *
 * Categorizes errors by type to help consumers handle different error scenarios:
 * - TimeoutError: Operation exceeded time limit
 * - ValidationError: Invalid input parameters
 * - GitHubCliError: GitHub CLI command failed
 * - Generic errors: Unexpected failures
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolResult with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolResult {
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
  } else if (error instanceof GitHubCliError) {
    errorType = 'GitHubCliError';
    errorCode = 'GH_CLI_ERROR';
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

export function isTerminalError(error: unknown): boolean {
  if (error instanceof GitHubCliError) {
    // Some errors are retryable (network issues), others are not
    return error.exitCode !== undefined && error.exitCode !== 0;
  }
  return error instanceof ValidationError;
}
