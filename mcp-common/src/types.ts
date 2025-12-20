/**
 * Shared types for MCP servers
 *
 * This module defines discriminated union types for MCP tool results,
 * enabling type-safe error handling and response processing.
 *
 * @module types
 */

import { ValidationError } from './errors.js';

/**
 * Successful tool execution result with discriminated union type
 *
 * The `isError: false` discriminant enables TypeScript type narrowing.
 *
 * @property content - Array of text content objects
 * @property isError - Always false (discriminant for type narrowing)
 * @property _meta - Optional metadata object
 *
 * **MCP SDK Compatibility:**
 * Includes `[key: string]: unknown` index signature to support MCP SDK
 * extensions. This allows the MCP framework to add SDK-specific properties
 * without breaking type compatibility. Use factory functions
 * (createToolSuccess) to maintain type safety.
 *
 * @example
 * ```typescript
 * const result: ToolSuccess = {
 *   content: [{ type: 'text', text: 'Success' }],
 *   isError: false,
 * };
 * ```
 */
export interface ToolSuccess {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly isError: false; // Required discriminant for consistency
  readonly _meta?: Readonly<{ [key: string]: unknown }>;
  [key: string]: unknown; // MCP SDK compatibility
}

/**
 * Error tool execution result with discriminated union type
 *
 * The `isError: true` discriminant enables TypeScript type narrowing.
 * Must include errorType in _meta for error categorization.
 *
 * @property content - Array of text content objects
 * @property isError - Always true (discriminant for type narrowing)
 * @property _meta - Required metadata with errorType
 *
 * **MCP SDK Compatibility:**
 * Includes `[key: string]: unknown` index signature to support MCP SDK
 * extensions. This allows the MCP framework to add SDK-specific properties
 * without breaking type compatibility. Use factory functions
 * (createToolError) to maintain type safety.
 *
 * @example
 * ```typescript
 * const result: ToolError = {
 *   content: [{ type: 'text', text: 'Error occurred' }],
 *   isError: true,
 *   _meta: { errorType: 'ValidationError' },
 * };
 * ```
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
 * @throws {ValidationError} If text is null or undefined
 *
 * @example
 * ```typescript
 * return createToolSuccess("Operation completed successfully");
 * return createToolSuccess("User created", { userId: "123" });
 * return createToolSuccess(""); // Empty string is valid
 *
 * // These will throw ValidationError:
 * // createToolSuccess(null);       // Error: text is null
 * // createToolSuccess(undefined);  // Error: text is undefined
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
  // Fail-fast validation: reject null/undefined (but allow empty strings)
  if (text === null) {
    throw new ValidationError(
      'createToolSuccess: text parameter is required. Expected string, received null'
    );
  }
  if (text === undefined) {
    throw new ValidationError(
      'createToolSuccess: text parameter is required. Expected string, received undefined'
    );
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

  const result = {
    content: [{ type: 'text' as const, text }],
    isError: false as const,
    ...(meta && { _meta: Object.freeze(meta) }),
  };
  return Object.freeze(result) as ToolSuccess;
}

/**
 * Factory function to create an error tool result
 *
 * @param text - Error message text (empty string allowed, null/undefined rejected)
 * @param errorType - Error type for categorization (required, must be non-empty after trimming)
 * @param errorCode - Optional error code for programmatic handling
 * @param meta - Optional additional metadata
 * @returns A properly typed ToolError object
 * @throws {ValidationError} If text or errorType is null/undefined/empty
 *
 * @example
 * ```typescript
 * return createToolError("File not found", "NotFoundError", "FILE_NOT_FOUND");
 * return createToolError("Invalid input", "ValidationError");
 * return createToolError("", "SilentError"); // Empty text is valid
 *
 * // Whitespace trimmed automatically:
 * createToolError("error", "  ValidationError  "); // OK, trimmed to "ValidationError"
 *
 * // These will throw ValidationError:
 * // createToolError(null, "Error");      // Error: text is null
 * // createToolError("msg", null);        // Error: errorType is null
 * // createToolError("msg", "");          // Error: errorType is empty
 * // createToolError("msg", "   ");       // Error: errorType is whitespace-only
 * ```
 */
export function createToolError(
  text: string,
  errorType: string,
  errorCode?: string,
  meta?: Record<string, unknown>
): ToolError {
  // Fail-fast validation for text (allow empty strings)
  if (text === null) {
    throw new ValidationError(
      'createToolError: text parameter is required. Expected string, received null'
    );
  }
  if (text === undefined) {
    throw new ValidationError(
      'createToolError: text parameter is required. Expected string, received undefined'
    );
  }

  // Fail-fast validation for errorType (must be non-empty after trimming)
  if (errorType === null) {
    throw new ValidationError(
      'createToolError: errorType parameter is required. Expected string, received null'
    );
  }
  if (errorType === undefined) {
    throw new ValidationError(
      'createToolError: errorType parameter is required. Expected string, received undefined'
    );
  }
  if (typeof errorType === 'string' && errorType.trim().length === 0) {
    throw new ValidationError(
      `createToolError: errorType parameter cannot be empty. Expected non-empty string, received '${errorType}'`
    );
  }

  // Validate that meta doesn't contain reserved keys
  if (meta && ('isError' in meta || 'content' in meta)) {
    console.warn(
      '[mcp-common] meta contains reserved keys (isError, content), they will be overwritten'
    );
  }

  const result = {
    content: [{ type: 'text' as const, text }],
    isError: true as const,
    _meta: Object.freeze({
      errorType: errorType.trim(),
      ...(errorCode && { errorCode }),
      ...meta,
    }),
  };
  return Object.freeze(result) as ToolError;
}
