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
  isSystemError,
} from './errors.js';
import type { ToolResult, ToolError, ToolSuccess } from './types.js';
import { createToolError, createToolSuccess } from './types.js';

/**
 * Creates a ToolError from any error object with automatic type detection
 *
 * **Error Handling Strategy:**
 * - System errors (ENOMEM, ENOSPC, etc.): Re-thrown without wrapping
 * - Programming errors (TypeError, ReferenceError, SyntaxError): Logged and wrapped with metadata
 * - GitHubCliError: Includes exitCode, stderr, stdout in metadata
 * - McpError subclasses: Includes error code if available
 * - Unknown errors: Logged with stack trace, returns as UnknownError
 *
 * @param error - Any error object to convert
 * @returns ToolError with appropriate errorType and metadata
 * @throws Re-throws system errors (ENOMEM, ENOSPC, etc.) that cannot be recovered from
 *
 * @example
 * ```typescript
 * const ghError = new GitHubCliError('gh failed', 128, 'permission denied', 'output');
 * const result = createErrorResult(ghError);
 * // result._meta includes: { errorType, errorCode, exitCode, stderr, stdout }
 * ```
 */
export function createErrorResult(error: unknown): ToolError {
  // Check for system errors first - these should never be wrapped
  if (isSystemError(error)) {
    console.error('[mcp-common] Critical system error detected, re-throwing:', {
      code: (error as any).code,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  let errorType = 'UnknownError';
  let errorCode: string | undefined;
  let additionalMeta: Record<string, unknown> = {};

  // Detect programming errors (TypeError, ReferenceError, SyntaxError)
  const isProgrammingError =
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError;

  if (isProgrammingError && error instanceof Error) {
    console.error('[mcp-common] Programming error detected:', {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
    });
    additionalMeta.isProgrammingError = true;
  }

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
      ...additionalMeta,
      exitCode: error.exitCode,
      stderr: error.stderr,
      ...(error.stdout && { stdout: error.stdout }),
    };
  } else if (error instanceof McpError) {
    errorType = 'McpError';
    errorCode = error.code;
  } else {
    // Log unknown error types for debugging with stack trace
    if (error instanceof Error) {
      console.error('[mcp-common] Converting unknown error type to ToolError (expected):', {
        name: error.name,
        message: error.message,
        constructor: error.constructor.name,
        stack: error.stack,
      });
    } else {
      console.error('[mcp-common] Converting non-Error object to ToolError (expected):', error);
    }
  }

  console.debug('[mcp-common] Created error result:', {
    errorType,
    errorCode,
    message: message.substring(0, 100),
  });

  // Manual construction used instead of createToolError factory to preserve
  // programming error metadata that would be lost in factory's type narrowing
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
 * Similar to createErrorResult() but can return null for non-McpError types instead
 * of handling them as UnknownError. This allows callers to implement custom
 * error handling for non-MCP errors.
 *
 * **Current default behavior:** Defaults to fail-fast mode (fallbackToGeneric=false).
 * Pass true to get fallback behavior for non-MCP errors.
 *
 * Use this when you want to handle non-McpError types differently.
 * Use createErrorResult() when you want automatic UnknownError handling.
 *
 * @param error - The error to convert
 * @param fallbackToGeneric - Whether to fall back to generic error for non-MCP errors (default: false)
 * @returns ToolError for McpError instances, null for other error types (if fallbackToGeneric is false)
 * @throws {ValidationError} In development mode when non-McpError is passed with fallbackToGeneric=false
 */
export function createErrorResultFromError(
  error: unknown,
  fallbackToGeneric = false
): ToolError | null {
  if (!(error instanceof McpError)) {
    if (!fallbackToGeneric) {
      const errorMessage = '[mcp-common] Non-McpError passed to createErrorResultFromError';

      // In development mode, throw instead of returning null
      if (process.env.NODE_ENV === 'development') {
        throw new ValidationError(
          `${errorMessage}. Use createErrorResult() for automatic handling or pass fallbackToGeneric=true.`
        );
      }

      console.warn(errorMessage, error);
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
