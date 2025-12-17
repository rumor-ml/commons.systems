/**
 * Result builder utilities for MCP tool responses
 *
 * Provides standardized functions for creating MCP-compliant tool results
 * with proper error categorization and metadata.
 *
 * @module result-builders
 */

import {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
} from './errors.js';
import type { ToolResult, ToolError, ToolSuccess } from './types.js';
import { createToolError } from './types.js';

/**
 * Create a standardized error result for MCP tool responses
 *
 * Categorizes errors by type to help consumers handle different error scenarios:
 * - TimeoutError: Operation exceeded time limit (may be retryable)
 * - ValidationError: Invalid input parameters (terminal, not retryable)
 * - NetworkError: Network-related failures (may be retryable)
 * - McpError: Generic MCP-related errors (base class for all custom errors)
 * - Generic errors: Unexpected failures (unknown error types)
 *
 * This function acts as a protocol bridge, converting TypeScript Error objects
 * into MCP-compliant ToolError format with structured metadata for error
 * categorization and retry logic.
 *
 * @param error - The error to convert to a tool result
 * @returns Standardized ToolError with error information and type metadata
 */
export function createErrorResult(error: unknown): ToolError {
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
  } else if (error instanceof NetworkError) {
    errorType = 'NetworkError';
    errorCode = 'NETWORK_ERROR';
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

/**
 * Create a successful tool result with optional metadata
 *
 * @param text - The response text
 * @param meta - Optional metadata to include in the result
 * @returns Standardized ToolSuccess
 */
export function createSuccessResult(
  text: string,
  meta?: { [key: string]: unknown }
): ToolSuccess {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    isError: false,
    ...(meta && { _meta: meta }),
  };
}

/**
 * Create error result from common mcp-common error types
 *
 * Handles TimeoutError, ValidationError, NetworkError, GitHubCliError, McpError.
 * Returns null for unknown error types - servers handle those specifically.
 *
 * @param error - The error to convert
 * @returns ToolError for known error types, null for unknown types
 */
export function createErrorResultFromError(error: unknown): ToolError | null {
  if (!(error instanceof McpError)) {
    return null;
  }

  const message = error.message;

  if (error instanceof TimeoutError) {
    return createToolError(message, 'TimeoutError', 'TIMEOUT');
  }
  if (error instanceof ValidationError) {
    return createToolError(message, 'ValidationError', 'VALIDATION_ERROR');
  }
  if (error instanceof NetworkError) {
    return createToolError(message, 'NetworkError', 'NETWORK_ERROR');
  }
  if (error instanceof GitHubCliError) {
    return createToolError(message, 'GitHubCliError', 'GH_CLI_ERROR');
  }

  return createToolError(message, 'McpError', error.code);
}
