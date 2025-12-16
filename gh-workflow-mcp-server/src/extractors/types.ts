/**
 * Shared types for framework-specific test failure extractors
 */

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
  parseWarnings?: string;
}

export interface FrameworkExtractor {
  readonly name: TestFramework;
  detect(logText: string): DetectionResult | null;
  extract(logText: string, maxErrors?: number): ExtractionResult;
}
