/**
 * Shared types for framework-specific test failure extractors
 */

export type TestFramework = "go" | "playwright" | "generic";

export interface DetectionResult {
  framework: TestFramework;
  confidence: "high" | "medium" | "low";
  isJsonOutput: boolean;
}

export interface ExtractedError {
  testName?: string;
  fileName?: string;
  lineNumber?: number;
  message: string;
  context: string[];
}

export interface ExtractionResult {
  framework: TestFramework;
  errors: ExtractedError[];
  summary?: string;
}

export interface FrameworkExtractor {
  readonly name: TestFramework;
  detect(logText: string): DetectionResult | null;
  extract(logText: string, maxErrors?: number): ExtractionResult;
}
