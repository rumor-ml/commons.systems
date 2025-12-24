/**
 * Shared types for framework-specific test failure extractors
 */

import { z } from 'zod';

export type TestFramework = 'go' | 'playwright' | 'tap' | 'unknown';

export interface DetectionResult {
  readonly framework: TestFramework;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly isJsonOutput: boolean;
  readonly isTimeout?: boolean;
}

export interface ExtractedError {
  readonly testName?: string;
  readonly fileName?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
  readonly message: string;
  readonly stack?: string; // Full stack trace
  readonly codeSnippet?: string; // Code context around failure (Playwright)
  readonly duration?: number; // Test duration in ms
  readonly failureType?: string; // e.g., 'testCodeFailure', 'timeout'
  readonly errorCode?: string; // e.g., 'ERR_ASSERTION'
  readonly rawOutput: readonly string[]; // All output lines for this test
}

/**
 * Zod schema for runtime validation of ExtractedError
 *
 * Ensures that extracted errors meet structural and type requirements:
 * - message is non-empty
 * - line/column numbers are positive integers
 * - duration is non-negative
 * - rawOutput contains at least one line
 */
export const ExtractedErrorSchema = z.object({
  testName: z.string().optional(),
  fileName: z.string().optional(),
  lineNumber: z.number().int().positive().optional(),
  columnNumber: z.number().int().positive().optional(),
  message: z.string().min(1),
  stack: z.string().optional(),
  codeSnippet: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  failureType: z.string().optional(),
  errorCode: z.string().optional(),
  rawOutput: z.array(z.string()).min(1),
});

/** Type inferred from ExtractedErrorSchema */
export type ValidatedExtractedError = z.infer<typeof ExtractedErrorSchema>;

/**
 * Validate an extracted error against the schema
 *
 * @param data - Data to validate
 * @returns Validated ExtractedError
 * @throws ZodError if validation fails with details about what's invalid
 */
export function validateExtractedError(data: unknown): ValidatedExtractedError {
  return ExtractedErrorSchema.parse(data);
}

/**
 * Type guard to check if an error is a Zod validation error
 */
export function isZodError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}

/**
 * Format a Zod validation error into a human-readable string
 *
 * @param error - Zod error to format
 * @returns Formatted error message with field paths and issues
 */
export function formatValidationError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
  return issues.join('; ');
}

/**
 * Create a fallback error that is valid-by-construction
 *
 * Used when validation fails - ensures we always return SOMETHING to the user
 * rather than silently dropping test failures.
 *
 * VALID-BY-CONSTRUCTION GUARANTEE:
 * This function constructs an ExtractedError that will ALWAYS pass validation
 * by explicitly handling all schema requirements:
 *
 * 1. message: Constructed with validation diagnostics + original message (never empty)
 * 2. rawOutput: Guaranteed at least one element via getRawOutput helper
 * 3. lineNumber/columnNumber: Filtered to positive integers via isPositiveInteger
 * 4. duration: Filtered to non-negative via isNonNegativeNumber
 * 5. Optional fields: Passed through if valid, otherwise undefined
 *    TODO(#509): Clarify what "valid" means (type-checked? non-empty? schema-validated?)
 *
 * WHY VALIDATION IS NEEDED:
 * Test framework output can be malformed in many ways:
 * - Empty error messages
 * - Missing rawOutput arrays
 * - Negative line numbers
 * - Invalid duration values
 * - Truncated JSON
 *
 * Rather than failing silently when we encounter malformed output, we construct
 * a valid error that includes both the original data AND validation diagnostics,
 * ensuring users see the failure with helpful debugging context.
 *
 * @param context - Description of what failed (e.g., "test TestFoo")
 * @param originalData - The data that failed validation (for diagnostics)
 * @param validationError - The Zod error describing what was invalid
 * @returns ExtractedError guaranteed to pass validation
 */
export function createFallbackError(
  context: string,
  originalData: unknown,
  validationError: z.ZodError
): ExtractedError {
  // Extract whatever we can from original data
  const partial = originalData as Partial<ExtractedError>;

  // Construct message with validation diagnostics
  const validationDetails = formatValidationError(validationError);
  const truncatedDetails =
    validationDetails.length > 500
      ? validationDetails.substring(0, 500) + '... (truncated)'
      : validationDetails;

  let message = `Malformed test output detected for ${context}.\n\n`;
  message += `Validation errors: ${truncatedDetails}\n\n`;

  // Include original message if it exists and is non-empty
  if (typeof partial.message === 'string' && partial.message.length > 0) {
    message += `Original message:\n${partial.message}`;
  }

  // Construct rawOutput - ensure at least one element
  const rawOutput = getRawOutput(partial, context);

  // Return valid-by-construction error
  return {
    message,
    rawOutput,
    testName: partial.testName,
    fileName: partial.fileName,
    lineNumber: isPositiveInteger(partial.lineNumber) ? partial.lineNumber : undefined,
    columnNumber: isPositiveInteger(partial.columnNumber) ? partial.columnNumber : undefined,
    duration: isNonNegativeNumber(partial.duration) ? partial.duration : undefined,
    failureType: partial.failureType,
    errorCode: partial.errorCode,
    stack: partial.stack,
    codeSnippet: partial.codeSnippet,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && value >= 0;
}

function getRawOutput(partial: Partial<ExtractedError>, context: string): string[] {
  if (Array.isArray(partial.rawOutput) && partial.rawOutput.length > 0) {
    return partial.rawOutput;
  }
  if (typeof partial.message === 'string' && partial.message.length > 0) {
    return [partial.message];
  }
  return [`Test output failed validation: ${context}`];
}

/**
 * Track validation failures for a single extraction operation with integrity checks
 *
 * Created per extract() call to accumulate validation errors from malformed test output.
 * Not persistent across calls.
 *
 * FEATURES:
 * - Distinguishes expected errors (malformed test output) from bugs (extraction code)
 * - Tracks failure count with defensive sanity checks (detects count corruption)
 * - Validates internal consistency (count vs warnings.length)
 * - Generates summary messages for users
 * - Provides detailed warnings for debugging
 *
 * INTEGRITY CHECKS:
 * - Detects negative counts (indicates memory corruption or overflow)
 * - Detects count/array length mismatch (indicates state corruption)
 * - Logs [BUG] messages to stderr when corruption detected
 *
 * USAGE:
 *   const tracker = new ValidationErrorTracker();
 *   tracker.recordValidationFailure('test #5', zodError);
 *   const warning = tracker.getSummaryWarning();
 */
export class ValidationErrorTracker {
  private validationFailures = 0;
  private warnings: string[] = [];

  /**
   * Record a validation failure
   * @param context - Context about what failed (e.g., "test #5", "Go test event")
   * @param error - The Zod validation error
   */
  recordValidationFailure(context: string, error: z.ZodError): void {
    // Sanity check: detect count corruption - this is a BUG
    if (this.validationFailures < 0) {
      throw new Error(
        `INTERNAL BUG: ValidationErrorTracker state corrupted. ` +
          `validationFailures=${this.validationFailures} (expected >= 0). ` +
          `This indicates memory corruption or a bug in the tracker. ` +
          `Context: ${context}`
      );
    }

    this.validationFailures++;
    const formatted = formatValidationError(error);
    this.warnings.push(`${context}: ${formatted}`);

    // Sanity check: count should match warnings array length
    if (this.validationFailures !== this.warnings.length) {
      throw new Error(
        `INTERNAL BUG: ValidationErrorTracker state corruption after increment. ` +
          `validationFailures=${this.validationFailures}, warnings.length=${this.warnings.length}. ` +
          `Context: ${context}`
      );
    }
  }

  /**
   * Get count of validation failures
   */
  getFailureCount(): number {
    return this.validationFailures;
  }

  /**
   * Generate summary warning message for parse warnings
   * Returns undefined if no failures
   */
  getSummaryWarning(): string | undefined {
    // Sanity check: detect negative count - this is a BUG
    if (this.validationFailures < 0) {
      throw new Error(
        `INTERNAL BUG: ValidationErrorTracker state corrupted. ` +
          `validationFailures=${this.validationFailures} (expected >= 0). ` +
          `This indicates memory corruption or a bug in the tracker.`
      );
    }

    // Sanity check: count should match warnings array length
    if (this.validationFailures !== this.warnings.length) {
      throw new Error(
        `INTERNAL BUG: ValidationErrorTracker state corruption. ` +
          `validationFailures=${this.validationFailures}, warnings.length=${this.warnings.length}. ` +
          `Count and array size must match.`
      );
    }

    if (this.validationFailures === 0) {
      return undefined;
    }
    return `${this.validationFailures} test events failed validation - malformed output detected`;
  }

  /**
   * Get detailed warnings for debugging
   */
  getDetailedWarnings(): string[] {
    return [...this.warnings];
  }
}

/**
 * Safe wrapper for validateExtractedError that distinguishes error types
 *
 * Always returns an ExtractedError (either validated or fallback). When validation
 * fails, creates a fallback error that includes validation diagnostics so users
 * can see what went wrong rather than silently losing test failures.
 *
 * @param data - Data to validate
 * @param context - Context for error messages (e.g., "test #5")
 * @param tracker - ValidationErrorTracker to record failures
 * @returns Always returns an ExtractedError (validated or fallback)
 * @throws Non-Zod errors (bugs in extraction code)
 */
// All extractor fallback paths verified in #332 - using safeValidateExtractedError consistently
// TODO(#506): Fix inaccurate line number references (all numbers are 6-50 lines off)
// See playwright-extractor.ts: parsePlaywrightTimeout (259), parsePlaywrightJson (459, 483, 517), parsePlaywrightText (595)
export function safeValidateExtractedError(
  data: unknown,
  context: string,
  tracker: ValidationErrorTracker
): ExtractedError {
  try {
    return validateExtractedError(data);
  } catch (error) {
    if (isZodError(error)) {
      // Expected validation error - malformed test output
      tracker.recordValidationFailure(context, error);

      // CRITICAL: Log prominently that we're showing fallback to user
      const dataSnippet = JSON.stringify(data, null, 2);
      const truncatedData =
        dataSnippet.length > 500 ? dataSnippet.substring(0, 500) + '... (truncated)' : dataSnippet;

      console.error(
        `[ERROR] Extractor validation failure for ${context}: ${formatValidationError(error)}\n` +
          `  This test failure will be shown to user as fallback error.\n` +
          `  Original data: ${truncatedData}`
      );

      // Return valid-by-construction fallback
      return createFallbackError(context, data, error);
    }
    // Unexpected error - bug in extraction code, let it propagate
    throw error;
  }
}

/**
 * Result of extracting test failures from framework output
 */
export interface ExtractionResult {
  /** Test framework that produced this output */
  readonly framework: TestFramework;

  /** Structured error information extracted from test failures */
  readonly errors: ExtractedError[];

  /** Human-readable summary (e.g., "3 failed, 77 passed") */
  readonly summary?: string;

  /**
   * Optional warning message about parse issues
   * Example: "5 test events failed to parse - check stderr for [ERROR] Go extractor messages"
   */
  readonly parseWarnings?: string;
}

export interface FrameworkExtractor {
  readonly name: TestFramework;
  detect(logText: string): DetectionResult | null;
  extract(logText: string, maxErrors?: number): ExtractionResult;
}
