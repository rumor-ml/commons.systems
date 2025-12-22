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
 * **WARNING - Index Signature Escape Hatch:**
 * The `[key: string]: unknown` index signature allows bypassing TypeScript's
 * type safety. This is ONLY intended for MCP SDK internal use. Application
 * code should NEVER rely on this - always use createToolSuccess() factory
 * function to ensure proper validation and type safety.
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
  // WARNING: Index signature allows bypassing type safety - use createToolSuccess() instead
  [key: string]: unknown; // MCP SDK compatibility only
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
 * **WARNING - Index Signature Escape Hatch:**
 * The `[key: string]: unknown` index signature allows bypassing TypeScript's
 * type safety. This is ONLY intended for MCP SDK internal use. Application
 * code should NEVER rely on this - always use createToolError() factory
 * function to ensure proper validation and type safety.
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
  // WARNING: Index signature allows bypassing type safety - use createToolError() instead
  [key: string]: unknown; // MCP SDK compatibility only
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
 * Runtime validator to check if an unknown value is a valid ToolResult
 *
 * Performs runtime validation to ensure an object conforms to the ToolResult
 * type structure. Useful for validating external data or API responses.
 *
 * **Validation checks:**
 * - Object exists and is not null
 * - Has 'isError' and 'content' properties
 * - If isError is true, _meta must exist with errorType
 * - If isError is false, no required _meta fields
 *
 * @param result - Unknown value to validate
 * @returns true if result is a valid ToolResult, with type narrowing
 *
 * @example
 * ```typescript
 * const data: unknown = await fetchFromAPI();
 * if (validateToolResult(data)) {
 *   // TypeScript knows data is ToolResult
 *   if (data.isError) {
 *     console.error(data._meta.errorType);
 *   }
 * }
 * ```
 */
export function validateToolResult(result: unknown): result is ToolResult {
  if (!result || typeof result !== 'object') {
    return false;
  }

  if (!('isError' in result) || !('content' in result)) {
    return false;
  }

  const r = result as { isError: unknown; content: unknown; _meta?: unknown };

  // Validate content array
  if (!Array.isArray(r.content) || r.content.length === 0) {
    return false;
  }

  // For error results, _meta with errorType is required
  if (r.isError === true) {
    if (!r._meta || typeof r._meta !== 'object') {
      return false;
    }
    const meta = r._meta as Record<string, unknown>;
    return typeof meta.errorType === 'string' && meta.errorType.length > 0;
  }

  // For success results, isError must be false
  return r.isError === false;
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
 * **WARNING: Shallow Immutability Only**
 * This function uses Object.freeze for ONLY shallow immutability. Nested objects
 * and arrays in meta ARE FULLY MUTABLE at runtime. For example:
 * ```typescript
 * const result = createToolSuccess("test", { items: [1, 2] });
 * result._meta.items.push(3);  // This WILL modify the array!
 * ```
 * TypeScript's readonly annotations provide compile-time type safety but no
 * runtime enforcement. Do not rely on immutability for nested structures.
 *
 * **Development Mode:**
 * In NODE_ENV=development, warns when metadata contains nested objects that
 * are not deeply frozen.
 *
 * @param text - Success message text (empty string allowed, null/undefined rejected)
 * @param meta - Optional metadata to include
 * @returns A properly typed ToolSuccess object
 * @throws {ValidationError} If text is null, undefined, or an array
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
 * // createToolSuccess([]);         // Error: text is an array
 * ```
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

  // Validate that text is not an array
  if (Array.isArray(text)) {
    throw new ValidationError(
      'createToolSuccess: text parameter must be a string, not an array. Did you mean to pass text as a string?'
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
 * **WARNING: Shallow Immutability Only**
 * This function uses Object.freeze for ONLY shallow immutability. Nested objects
 * and arrays in meta ARE FULLY MUTABLE at runtime.
 *
 * **Development Mode:**
 * In NODE_ENV=development, throws ValidationError if meta contains reserved keys
 * (isError, content) instead of just warning.
 *
 * @param text - Error message text (empty string allowed, null/undefined rejected)
 * @param errorType - Error type for categorization (required, must be non-empty after trimming)
 * @param errorCode - Optional error code for programmatic handling
 * @param meta - Optional additional metadata (must not contain 'isError' or 'content' keys)
 * @returns A properly typed ToolError object
 * @throws {ValidationError} If text or errorType is null/undefined/empty, or if meta contains reserved keys (development mode only)
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
 * // createToolError("msg", "Error", undefined, { isError: true }); // Error in dev mode: reserved key
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

  // Validate that text is not an array
  if (Array.isArray(text)) {
    throw new ValidationError(
      'createToolError: text parameter must be a string, not an array. Did you mean to pass text as a string?'
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
    const errorMessage =
      '[mcp-common] meta contains reserved keys (isError, content), they will be overwritten';

    // In development mode, throw instead of just warning
    if (process.env.NODE_ENV === 'development') {
      throw new ValidationError(
        `${errorMessage}. Remove these keys from meta parameter - they are automatically set by the factory function.`
      );
    }

    console.warn(errorMessage);
  }

  const result = {
    content: [{ type: 'text' as const, text }],
    isError: true as const,
    _meta: Object.freeze({
      ...meta, // User metadata first
      errorType: errorType.trim(), // Then required fields
      ...(errorCode && { errorCode }),
    }),
  };
  return Object.freeze(result) as ToolError;
}
