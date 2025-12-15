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

export interface ExtractionResult {
  framework: TestFramework;
  errors: ExtractedError[];
  summary?: string;
  parseWarnings?: string;
}

export interface FrameworkExtractor {
  readonly name: TestFramework;
  detect(logText: string): DetectionResult | null;
  extract(logText: string, maxErrors?: number): ExtractionResult;
}
