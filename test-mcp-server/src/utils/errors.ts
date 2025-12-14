/**
 * Error handling utilities for Test MCP server
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

export class ScriptExecutionError extends McpError {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message, 'SCRIPT_EXECUTION_ERROR');
    this.name = 'ScriptExecutionError';
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

export class InfrastructureError extends McpError {
  constructor(message: string) {
    super(message, 'INFRASTRUCTURE_ERROR');
    this.name = 'InfrastructureError';
  }
}

/**
 * Create a standardized error result for MCP tool responses
 *
 * Categorizes errors by type to help consumers handle different error scenarios:
 * - TimeoutError: Operation exceeded time limit
 * - ValidationError: Invalid input parameters
 * - ScriptExecutionError: Shell script execution failed
 * - InfrastructureError: Infrastructure service failure
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
  } else if (error instanceof ScriptExecutionError) {
    errorType = 'ScriptExecutionError';
    errorCode = 'SCRIPT_EXECUTION_ERROR';
  } else if (error instanceof InfrastructureError) {
    errorType = 'InfrastructureError';
    errorCode = 'INFRASTRUCTURE_ERROR';
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
  if (error instanceof ScriptExecutionError) {
    // Some errors are retryable (transient issues), others are not
    return error.exitCode !== undefined && error.exitCode !== 0;
  }
  return error instanceof ValidationError;
}
