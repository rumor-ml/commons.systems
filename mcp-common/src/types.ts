/**
 * Shared types for MCP servers
 *
 * This module defines discriminated union types for MCP tool results,
 * enabling type-safe error handling and response processing.
 *
 * @module types
 */

/**
 * Successful tool result
 *
 * Contains response content with optional metadata. The isError field
 * is either false or undefined to distinguish from error results.
 */
export interface ToolSuccess {
  content: Array<{ type: 'text'; text: string }>;
  readonly isError?: false; // Discriminant should be immutable
  _meta?: { [key: string]: unknown };
  [key: string]: unknown; // MCP SDK compatibility
}

/**
 * Error tool result
 *
 * Contains error content with required error metadata. The isError field
 * must be true, and _meta must include errorType for error categorization.
 */
export interface ToolError {
  content: Array<{ type: 'text'; text: string }>;
  readonly isError: true; // Required discriminant - should be immutable
  _meta: {
    // Required for errors
    readonly errorType: string; // Error type should be immutable
    readonly errorCode?: string; // Error code should be immutable
    [key: string]: unknown;
  };
  [key: string]: unknown; // MCP SDK compatibility
}

/**
 * Discriminated union for tool results
 *
 * This uses TypeScript's discriminated union pattern with `isError` as the discriminant.
 * TypeScript's type narrowing automatically refines the type based on the discriminant check:
 * - When `result.isError === true`, TypeScript knows `result` is `ToolError` (has `_meta.errorType`)
 * - When `result.isError !== true`, TypeScript knows `result` is `ToolSuccess` (no required `_meta`)
 *
 * This provides compile-time type safety without runtime overhead. The type guards
 * `isToolError()` and `isToolSuccess()` leverage this for convenient type narrowing.
 *
 * @example
 * ```typescript
 * function handleResult(result: ToolResult) {
 *   if (result.isError) {
 *     // TypeScript knows this is ToolError - errorType is guaranteed to exist
 *     console.error(result._meta.errorType);
 *   } else {
 *     // TypeScript knows this is ToolSuccess - no required _meta
 *     console.log(result.content);
 *   }
 * }
 * ```
 */
export type ToolResult = ToolSuccess | ToolError;

/**
 * Type guard to check if a result is an error
 *
 * @param result - Tool result to check
 * @returns true if result is an error, with type narrowing
 */
export function isToolError(result: ToolResult): result is ToolError {
  return result.isError === true;
}

/**
 * Type guard to check if a result is successful
 *
 * @param result - Tool result to check
 * @returns true if result is successful, with type narrowing
 */
export function isToolSuccess(result: ToolResult): result is ToolSuccess {
  return result.isError !== true;
}

/**
 * Legacy type alias for backward compatibility
 *
 * @deprecated Use ToolResult instead
 */
export type ErrorResult = ToolError;

/**
 * Factory function to create a successful tool result
 *
 * @param text - Success message text
 * @param meta - Optional metadata to include
 * @returns A properly typed ToolSuccess object
 *
 * @example
 * ```typescript
 * return createToolSuccess("Operation completed successfully");
 * return createToolSuccess("User created", { userId: "123" });
 * ```
 */
export function createToolSuccess(
  text: string,
  meta?: Record<string, unknown>
): ToolSuccess {
  return {
    content: [{ type: 'text', text }],
    isError: false,
    ...(meta && { _meta: meta }),
  };
}

/**
 * Factory function to create an error tool result
 *
 * @param text - Error message text
 * @param errorType - Error type for categorization (e.g., "ValidationError", "TimeoutError")
 * @param errorCode - Optional error code for programmatic handling
 * @param meta - Optional additional metadata
 * @returns A properly typed ToolError object
 *
 * @example
 * ```typescript
 * return createToolError("File not found", "NotFoundError", "FILE_NOT_FOUND");
 * return createToolError("Invalid input", "ValidationError");
 * ```
 */
export function createToolError(
  text: string,
  errorType: string,
  errorCode?: string,
  meta?: Record<string, unknown>
): ToolError {
  return {
    content: [{ type: 'text', text }],
    isError: true,
    _meta: {
      errorType,
      ...(errorCode && { errorCode }),
      ...meta,
    },
  };
}
