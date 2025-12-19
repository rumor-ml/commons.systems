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
 * must be false to distinguish from error results.
 */
export interface ToolSuccess {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly isError: false; // Required discriminant for consistency
  readonly _meta?: Readonly<{ [key: string]: unknown }>;
  [key: string]: unknown; // MCP SDK compatibility
}

/**
 * Error tool result
 *
 * Contains error content with required error metadata. The isError field
 * must be true, and _meta must include errorType for error categorization.
 */
export interface ToolError {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly isError: true; // Required discriminant - should be immutable
  readonly _meta: Readonly<{
    // Required for errors
    readonly errorType: string; // Error type should be immutable
    readonly errorCode?: string; // Error code should be immutable
    [key: string]: unknown;
  }>;
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
 * @param text - Success message text (empty string allowed, null/undefined rejected)
 * @param meta - Optional metadata to include
 * @returns A properly typed ToolSuccess object
 *
 * @example
 * ```typescript
 * return createToolSuccess("Operation completed successfully");
 * return createToolSuccess("User created", { userId: "123" });
 * ```
 *
 * IMPORTANT: Uses Object.freeze for ONLY shallow immutability. Nested objects
 * and arrays in meta ARE FULLY MUTABLE at runtime. For example:
 *   const result = createToolSuccess("test", { items: [1, 2] });
 *   result._meta.items.push(3);  // This WILL modify the array!
 * TypeScript's readonly annotations provide compile-time type safety but no
 * runtime enforcement. Do not rely on immutability for nested structures.
 */
export function createToolSuccess(text: string, meta?: Record<string, unknown>): ToolSuccess {
  // Use safe defaults instead of throwing
  const safeText = text ?? '[Error: missing success message]';

  // Warn if we had to use defaults
  const warnings: string[] = [];
  if (!text && text !== '') {
    warnings.push('[Warning: success message was missing]');
    console.warn('[mcp-common] createToolSuccess called with invalid text:', text);
  }

  // Warn about nested objects in development
  if (process.env.NODE_ENV === 'development' && meta) {
    const hasNestedObjects = Object.values(meta).some((v) => v !== null && typeof v === 'object');
    if (hasNestedObjects) {
      console.warn(
        '[mcp-common] Metadata contains nested objects which are not deeply frozen:',
        meta
      );
    }
  }

  const finalText = warnings.length > 0 ? `${warnings.join(' ')} ${safeText}` : safeText;

  const result = {
    content: [{ type: 'text' as const, text: finalText }],
    isError: false as const,
    ...(meta && { _meta: Object.freeze(meta) }),
  };
  return Object.freeze(result) as ToolSuccess;
}

/**
 * Factory function to create an error tool result
 *
 * @param text - Error message text (empty string allowed, null/undefined rejected)
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
  // Use safe defaults instead of throwing
  const safeText = text ?? '[Error: missing error message]';
  const safeErrorType = errorType?.trim() || 'UnknownError';

  // Collect warnings for invalid inputs
  const warnings: string[] = [];
  if (!errorType || errorType.trim().length === 0) {
    warnings.push('[Warning: errorType was empty, using "UnknownError"]');
    console.warn('[mcp-common] createToolError called with empty errorType');
  }
  if (!text && text !== '') {
    warnings.push('[Warning: error message was missing]');
    console.warn('[mcp-common] createToolError called with invalid text:', text);
  }

  // Validate that meta doesn't contain reserved keys
  if (meta && ('isError' in meta || 'content' in meta)) {
    console.warn(
      '[mcp-common] meta contains reserved keys (isError, content), they will be overwritten'
    );
  }

  const finalText = warnings.length > 0 ? `${warnings.join(' ')} ${safeText}` : safeText;

  const result = {
    content: [{ type: 'text' as const, text: finalText }],
    isError: true as const,
    _meta: Object.freeze({
      errorType: safeErrorType,
      ...(errorCode && { errorCode }),
      ...meta,
    }),
  };
  return Object.freeze(result) as ToolError;
}
