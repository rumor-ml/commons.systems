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
import { createToolError, createToolSuccess } from './types.js';

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
  } else {
    // Log unknown error types for debugging
    if (error instanceof Error) {
      console.error('[mcp-common] Unknown error type encountered:', {
        name: error.name,
        message: error.message,
        constructor: error.constructor.name,
      });
    } else {
      console.error('[mcp-common] Non-Error object thrown:', error);
    }
  }

  console.debug('[mcp-common] Created error result:', {
    errorType,
    errorCode,
    message: message.substring(0, 100),
  });

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
 * Uses the createToolSuccess factory for consistent result creation.
 *
 * @param text - The response text
 * @param meta - Optional metadata to include in the result
 * @returns Standardized ToolSuccess
 */
export function createSuccessResult(
  text: string,
  meta?: { [key: string]: unknown }
): ToolSuccess {
  return createToolSuccess(text, meta);
}

/**
 * Create error result from mcp-common error types (specialized version)
 *
 * Similar to createErrorResult() but returns null for non-McpError types instead
 * of handling them as UnknownError. This allows callers to implement custom
 * error handling for non-MCP errors.
 *
 * Use this when you want to handle non-McpError types differently.
 * Use createErrorResult() when you want automatic UnknownError handling.
 *
 * @param error - The error to convert
 * @param fallbackToGeneric - Whether to fall back to generic error for non-MCP errors (default: true)
 * @returns ToolError for McpError instances, null for other error types (if fallbackToGeneric is false)
 */
export function createErrorResultFromError(
  error: unknown,
  fallbackToGeneric = true
): ToolError | null {
  if (!(error instanceof McpError)) {
    if (!fallbackToGeneric) {
      console.warn('[mcp-common] Non-McpError passed to createErrorResultFromError:', error);
      return null;
    }

    // Fallback for non-MCP errors
    const message = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

    console.warn('[mcp-common] Converting non-MCP error to generic ToolError:', {
      errorType,
      message: message.substring(0, 100),
    });

    return createToolError(message, errorType, 'UNKNOWN_ERROR');
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
