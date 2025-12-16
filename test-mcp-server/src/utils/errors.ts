/**
 * Error handling utilities for Test MCP server
 */

import type { ToolError } from '@commons/mcp-common/types';
import {
  McpError,
  TimeoutError,
  ValidationError,
  formatError,
  isTerminalError as baseIsTerminalError,
} from '@commons/mcp-common/errors';

// Re-export common errors for convenience
export { McpError, TimeoutError, ValidationError, formatError };

// Test-specific error classes
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

export class InfrastructureError extends McpError {
  constructor(message: string) {
    super(message, 'INFRASTRUCTURE_ERROR');
    this.name = 'InfrastructureError';
  }
}

export class TestOutputParseError extends McpError {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly parseError: Error
  ) {
    super(message, 'TEST_OUTPUT_PARSE_ERROR');
    this.name = 'TestOutputParseError';
  }
}

/**
 * Check if an error is terminal (should stop retrying)
 *
 * Extends the base isTerminalError from mcp-common to handle test-specific errors.
 *
 * Terminal Error Classification:
 * - ValidationError: Always terminal (bad input won't fix itself)
 * - ScriptExecutionError with non-zero exit code: Terminal (script failed definitively)
 * - InfrastructureError: Terminal (infrastructure down/misconfigured, retries won't help)
 * - TestOutputParseError: Terminal (malformed output won't fix with retries)
 * - TimeoutError: Potentially retryable (may succeed with more time)
 * - NetworkError: Potentially retryable (transient network issues)
 * - Other errors: Delegate to base implementation (conservative: potentially retryable)
 *
 * Rationale:
 * - Infrastructure failures (emulators down, services unavailable) require manual intervention
 * - Parse errors indicate script output format issues that won't resolve on retry
 * - Script execution failures with exit codes are definitive failures
 * - Timeouts and network errors may be transient and worth retrying
 *
 * @param error - The error to check
 * @returns true if the error is terminal and should not be retried
 */
export function isTerminalError(error: unknown): boolean {
  // ScriptExecutionError with non-zero exit code is terminal
  if (error instanceof ScriptExecutionError) {
    return error.exitCode !== undefined && error.exitCode !== 0;
  }

  // InfrastructureError is terminal - infrastructure must be fixed before retrying
  // Examples: Firebase emulators not running, services unavailable, port conflicts
  if (error instanceof InfrastructureError) {
    return true;
  }

  // TestOutputParseError is terminal - script output format is wrong
  // Retrying won't help; the script needs to be fixed or output parsing updated
  if (error instanceof TestOutputParseError) {
    return true;
  }

  // Delegate to base implementation for common errors
  // (ValidationError=terminal, TimeoutError/NetworkError=retryable)
  return baseIsTerminalError(error);
}

/**
 * Create a standardized error result for MCP tool responses
 *
 * Extends the base createErrorResult from mcp-common to handle test-specific errors:
 * - ScriptExecutionError: Shell script execution failed
 * - InfrastructureError: Infrastructure service failure
 * - TestOutputParseError: Test output parsing failed
 *
 * For common errors (TimeoutError, ValidationError), this delegates to the base
 * implementation in mcp-common.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolError with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolError {
  const message = error instanceof Error ? error.message : String(error);
  let errorType = 'UnknownError';
  let errorCode: string | undefined;

  // Categorize test-specific error types
  if (error instanceof ScriptExecutionError) {
    errorType = 'ScriptExecutionError';
    errorCode = 'SCRIPT_EXECUTION_ERROR';
  } else if (error instanceof InfrastructureError) {
    errorType = 'InfrastructureError';
    errorCode = 'INFRASTRUCTURE_ERROR';
  } else if (error instanceof TestOutputParseError) {
    errorType = 'TestOutputParseError';
    errorCode = 'TEST_OUTPUT_PARSE_ERROR';
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
