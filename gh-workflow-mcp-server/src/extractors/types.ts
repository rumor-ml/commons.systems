/**
 * Shared types for framework-specific test failure extractors
 */

import { z } from 'zod';

export type TestFramework = 'go' | 'playwright' | 'tap' | 'unknown';

export interface DetectionResult {
  framework: TestFramework;
  confidence: 'high' | 'medium' | 'low';
  isJsonOutput: boolean;
  isTimeout?: boolean;
}

export interface ExtractedError {
  testName?: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  message: string;
  stack?: string; // Full stack trace
  codeSnippet?: string; // Code context around failure (Playwright)
  duration?: number; // Test duration in ms
  failureType?: string; // e.g., 'testCodeFailure', 'timeout'
  errorCode?: string; // e.g., 'ERR_ASSERTION'
  rawOutput: string[]; // All output lines for this test
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
  let rawOutput: string[];
  if (Array.isArray(partial.rawOutput) && partial.rawOutput.length > 0) {
    rawOutput = partial.rawOutput;
  } else if (typeof partial.message === 'string' && partial.message.length > 0) {
    rawOutput = [partial.message];
  } else {
    rawOutput = [`Test output failed validation: ${context}`];
  }

  // Helper to validate positive integers
  function positiveIntOrUndefined(value: unknown): number | undefined {
    return typeof value === 'number' && value > 0 ? value : undefined;
  }

  // Helper to validate non-negative numbers
  function nonNegativeOrUndefined(value: unknown): number | undefined {
    return typeof value === 'number' && value >= 0 ? value : undefined;
  }

  // Return valid-by-construction error
  return {
    message, // Always non-empty
    rawOutput, // Always has at least 1 element
    // Include valid metadata if present
    testName: partial.testName,
    fileName: partial.fileName,
    lineNumber: positiveIntOrUndefined(partial.lineNumber),
    columnNumber: positiveIntOrUndefined(partial.columnNumber),
    duration: nonNegativeOrUndefined(partial.duration),
    failureType: partial.failureType,
    errorCode: partial.errorCode,
    stack: partial.stack,
    codeSnippet: partial.codeSnippet,
  };
}

/**
 * Track validation failures across extraction process
 *
 * Distinguishes expected validation errors (malformed test output)
 * from unexpected errors (bugs in extraction code).
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
    // Sanity check: detect count corruption
    if (this.validationFailures < 0) {
      console.error(
        `[BUG] ValidationErrorTracker.recordValidationFailure: validationFailures is negative (${this.validationFailures}). Resetting to 0.`
      );
      this.validationFailures = 0;
    }

    this.validationFailures++;
    const formatted = formatValidationError(error);
    this.warnings.push(`${context}: ${formatted}`);

    // Sanity check: count should match warnings array length
    if (this.validationFailures !== this.warnings.length) {
      console.error(
        `[BUG] ValidationErrorTracker.recordValidationFailure: count mismatch after increment. ` +
          `validationFailures=${this.validationFailures}, warnings.length=${this.warnings.length}. ` +
          `This indicates state corruption.`
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
    // Sanity check: detect negative count
    if (this.validationFailures < 0) {
      console.error(
        `[BUG] ValidationErrorTracker.getSummaryWarning: validationFailures is negative (${this.validationFailures}). ` +
          `Returning diagnostic message.`
      );
      return `INTERNAL ERROR: Validation failure count corrupted (${this.validationFailures} < 0). Please file bug report.`;
    }

    // Sanity check: count should match warnings array length
    if (this.validationFailures !== this.warnings.length) {
      console.error(
        `[BUG] ValidationErrorTracker.getSummaryWarning: count mismatch. ` +
          `validationFailures=${this.validationFailures}, warnings.length=${this.warnings.length}. ` +
          `Using warnings.length as source of truth.`
      );
      // Use warnings.length as source of truth
      const actualCount = this.warnings.length;
      if (actualCount === 0) {
        return undefined;
      }
      return `${actualCount} test events failed validation - malformed output detected (count mismatch detected)`;
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
