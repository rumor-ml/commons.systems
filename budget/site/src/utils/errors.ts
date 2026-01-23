/**
 * Typed error class for Budget module errors
 *
 * Provides a typed error class for categorizing failures in the Budget module.
 * Error codes enable structured error handling and recovery strategies.
 */

/**
 * Type-safe error codes for Budget module errors
 */
export type BudgetErrorCode =
  | 'DATA_VALIDATION' // Invalid transaction/budget data
  | 'CHART_RENDER' // Chart rendering failure
  | 'STORAGE_ACCESS' // localStorage read/write failure
  | 'HYDRATION' // Island hydration failure
  | 'PROPS_PARSE' // Failed to parse island props
  | 'CALCULATION' // Math/aggregation error
  | 'UNEXPECTED'; // Unknown error

/**
 * Structured context for BudgetError instances
 *
 * Provides type-safe fields for common error context patterns while
 * maintaining flexibility through index signature.
 */
export interface BudgetErrorContext {
  // Error details
  error?: Error | unknown;
  stack?: string;
  componentStack?: string;

  // Location context
  file?: string;
  line?: number;
  component?: string;

  // Additional structured data
  [key: string]: unknown;
}

/**
 * Budget module error with typed error code and optional context
 *
 * Extends standard Error with Budget-specific context including:
 * - Typed error code for categorization
 * - Optional context object for debugging data
 */
export class BudgetError extends Error {
  constructor(
    message: string,
    public readonly code: BudgetErrorCode,
    public readonly context?: BudgetErrorContext
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}

/**
 * Type guard to check if an error is a BudgetError
 *
 * @param error - Error to check
 * @returns true if error is a BudgetError instance
 */
export function isBudgetError(error: unknown): error is BudgetError {
  return error instanceof BudgetError;
}

/**
 * Format an error for display with optional context and stack trace
 *
 * Formats errors with type information and optional stack traces for debugging.
 * For BudgetError instances, includes error code and context if present.
 *
 * @param error - Error to format
 * @param includeStack - Whether to include stack trace (default: false)
 * @returns Formatted error message string
 */
export function formatBudgetError(error: unknown, includeStack = false): string {
  if (error instanceof BudgetError) {
    const parts = [`[${error.name}]`, `(${error.code})`, error.message];

    if (error.context && Object.keys(error.context).length > 0) {
      try {
        parts.push(`\nContext: ${JSON.stringify(error.context, null, 2)}`);
      } catch (stringifyError) {
        // Handle circular references or non-serializable objects
        const errorMessage =
          stringifyError instanceof Error ? stringifyError.message : String(stringifyError);
        parts.push(`\nContext: [Unable to serialize: ${errorMessage}]`);
      }
    }

    if (includeStack && error.stack) {
      parts.push(`\nStack: ${error.stack}`);
    }

    return parts.filter(Boolean).join(' ');
  }

  if (error instanceof Error) {
    const formatted = `[${error.name}] ${error.message}`;
    return includeStack && error.stack ? `${formatted}\nStack: ${error.stack}` : formatted;
  }

  return String(error);
}
