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
 * Creates a ToolError from any error object with automatic type detection
 *
 * Preserves rich error context:
 * - GitHubCliError: Includes exitCode, stderr, stdout in metadata
 * - McpError subclasses: Includes error code if available
 * - Unknown errors: Logs to console, returns as UnknownError
 *
 * @param error - Any error object to convert
 * @returns ToolError with appropriate errorType and metadata
 *
 * @example
 * ```typescript
 * const ghError = new GitHubCliError('gh failed', 128, 'permission denied', 'output');
 * const result = createErrorResult(ghError);
 * // result._meta includes: { errorType, errorCode, exitCode, stderr, stdout }
 * ```
 */
export function createErrorResult(error: unknown): ToolError {
  const message = error instanceof Error ? error.message : String(error);
  let errorType = 'UnknownError';
  let errorCode: string | undefined;
  let additionalMeta: Record<string, unknown> = {};

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
    // Preserve debugging context from GitHubCliError
    additionalMeta = {
      exitCode: error.exitCode,
      stderr: error.stderr,
      ...(error.stdout && { stdout: error.stdout }),
    };
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
      ...(errorCode && { errorCode }),
      ...additionalMeta,
    },
  } as ToolError;
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
