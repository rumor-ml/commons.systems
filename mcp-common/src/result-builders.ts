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
  ParsingError,
  FormattingError,
  isSystemError,
} from './errors.js';
import type {
  ToolResult,
  ToolResultStrict,
  ToolError,
  ToolErrorStrict,
  ToolSuccess,
  ToolSuccessStrict,
} from './types.js';
import { createToolError, createToolSuccess } from './types.js';

/**
 * Shared error type mapping for consistent categorization
 */
interface ErrorTypeInfo {
  errorType: string;
  errorCode: string;
}

function getErrorTypeInfo(error: unknown): ErrorTypeInfo | null {
  if (error instanceof TimeoutError) {
    return { errorType: 'TimeoutError', errorCode: 'TIMEOUT' };
  }
  if (error instanceof ValidationError) {
    return { errorType: 'ValidationError', errorCode: 'VALIDATION_ERROR' };
  }
  if (error instanceof NetworkError) {
    return { errorType: 'NetworkError', errorCode: 'NETWORK_ERROR' };
  }
  if (error instanceof GitHubCliError) {
    return { errorType: 'GitHubCliError', errorCode: 'GH_CLI_ERROR' };
  }
  if (error instanceof ParsingError) {
    return { errorType: 'ParsingError', errorCode: 'PARSING_ERROR' };
  }
  if (error instanceof FormattingError) {
    return { errorType: 'FormattingError', errorCode: 'FORMATTING_ERROR' };
  }
  if (error instanceof McpError) {
    return { errorType: 'McpError', errorCode: error.code ?? 'UNKNOWN_ERROR' };
  }
  return null;
}

/**
 * Creates a ToolError from any error object with automatic type detection
 *
 * **Error Handling Strategy:**
 * - System errors (ENOMEM, ENOSPC, etc.): Re-thrown without wrapping
 * - Programming errors (TypeError, ReferenceError, SyntaxError): Logged and returned with
 *   user-facing message to report as bug, includes isProgrammingError=true metadata flag
 * - GitHubCliError: Includes exitCode, stderr, stdout in metadata
 * - ParsingError: Data parsing failures (retryable)
 * - FormattingError: Data structure violations (terminal)
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

    // Make it CLEAR to users this is a bug they should report
    return {
      content: [
        {
          type: 'text',
          text:
            `Internal Error (Bug): ${error.message}\n\n` +
            `This appears to be a programming error in the MCP server. ` +
            `Please report this issue with the following details:\n` +
            `- Error type: ${error.constructor.name}\n` +
            `- Stack trace available in server logs\n` +
            `- This should not happen during normal operation`,
        },
      ],
      isError: true,
      _meta: {
        errorType: error.constructor.name,
        errorCode: 'PROGRAMMING_ERROR',
        isProgrammingError: true,
        originalMessage: error.message,
      },
    } as ToolError;
  }

  // Categorize error types for better handling
  const typeInfo = getErrorTypeInfo(error);
  if (typeInfo) {
    errorType = typeInfo.errorType;
    errorCode = typeInfo.errorCode;

    // GitHubCliError needs special metadata handling
    if (error instanceof GitHubCliError) {
      additionalMeta.exitCode = error.exitCode;
      additionalMeta.stderr = error.stderr;
      if (error.stdout) {
        additionalMeta.stdout = error.stdout;
      }
    }
  } else {
    // ALWAYS log unknown error types - this indicates unexpected error types
    // that we should either handle explicitly or investigate
    if (error instanceof Error) {
      const logData: any = {
        name: error.name,
        message: error.message.substring(0, 200),
        constructor: error.constructor.name,
      };

      // Only include stack trace in development
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
        logData.stack = error.stack;
      }

      console.error('[mcp-common] Unknown error type converted to ToolError:', logData);
    } else {
      console.error('[mcp-common] Non-Error object converted to ToolError:', {
        type: typeof error,
        value: String(error).substring(0, 200),
      });
    }

    // In production, this data would ideally be sent to error tracking
    // (e.g., Sentry, Datadog) to monitor for third-party library errors
    // or unexpected failure patterns
  }

  if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
    console.debug('[mcp-common] Created error result:', {
      errorType,
      errorCode,
      message: message.substring(0, 100),
    });
  }

  return createToolError(
    `Error: ${message}`,
    errorType,
    errorCode,
    additionalMeta
  );
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
 * Create error result from McpError types only (specialized version)
 *
 * Unlike createErrorResult() which converts ALL errors to ToolError (including
 * programming errors, system errors, and unknown types), this function only
 * handles McpError instances and can return null for other types. This allows
 * callers to implement custom handling for non-MCP error types.
 *
 * **Current default behavior:** Defaults to fail-fast mode (fallbackToGeneric=false).
 * Pass true to get fallback behavior for non-MCP errors.
 *
 * Use this when you want explicit control over non-McpError handling.
 * Use createErrorResult() when you want automatic handling of all error types.
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

    return createToolError(`Error: ${message}`, errorType, 'UNKNOWN_ERROR');
  }

  const message = error.message;

  const typeInfo = getErrorTypeInfo(error);
  if (typeInfo) {
    return createToolError(`Error: ${message}`, typeInfo.errorType, typeInfo.errorCode);
  }

  return createToolError(`Error: ${message}`, 'McpError', error.code);
}
