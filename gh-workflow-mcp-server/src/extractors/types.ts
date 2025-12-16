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
    this.validationFailures++;
    const formatted = formatValidationError(error);
    this.warnings.push(`${context}: ${formatted}`);
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
 * @param data - Data to validate
 * @param context - Context for error messages (e.g., "test #5")
 * @param tracker - ValidationErrorTracker to record failures
 * @returns Validated error or null if validation failed
 * @throws Non-Zod errors (bugs in extraction code)
 */
export function safeValidateExtractedError(
  data: unknown,
  context: string,
  tracker: ValidationErrorTracker
): ValidatedExtractedError | null {
  try {
    return validateExtractedError(data);
  } catch (error) {
    if (isZodError(error)) {
      // Expected validation error - malformed test output
      tracker.recordValidationFailure(context, error);
      return null;
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
