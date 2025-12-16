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
