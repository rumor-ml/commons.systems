/**
 * Framework extractor registry and orchestration
 */

import type { ExtractionResult, FrameworkExtractor } from "./types.js";
import { GoExtractor } from "./go-extractor.js";
import { PlaywrightExtractor } from "./playwright-extractor.js";
import { GenericExtractor } from "./generic-extractor.js";

// Registry of extractors in priority order
const extractors: FrameworkExtractor[] = [
  new GoExtractor(),
  new PlaywrightExtractor(),
  new GenericExtractor(), // Always matches as fallback
];

/**
 * Extract errors from logs using framework-specific extractors
 * Returns the result from the first high-confidence match, or falls back to generic
 */
export function extractErrors(logText: string, maxErrors = 10): ExtractionResult {
  // Try each extractor in order, use first high-confidence match
  for (const extractor of extractors) {
    const detection = extractor.detect(logText);
    if (detection?.confidence === "high") {
      return extractor.extract(logText, maxErrors);
    }
  }

  // Fall back to generic extractor (always last in array)
  return extractors[extractors.length - 1].extract(logText, maxErrors);
}

/**
 * Format extraction result into human-readable text
 */
export function formatExtractionResult(result: ExtractionResult): string[] {
  const lines: string[] = [];

  if (result.errors.length === 0) {
    return ["No errors detected"];
  }

  for (const error of result.errors) {
    // Format error header
    const parts: string[] = [];

    if (error.testName) {
      parts.push(`--- FAIL: ${error.testName}`);
    }

    if (error.fileName) {
      const location = error.lineNumber
        ? `${error.fileName}:${error.lineNumber}`
        : error.fileName;
      parts.push(`    Location: ${location}`);
    }

    // Add error message (indented if there's a test name)
    const messageLines = error.message.split("\n");
    if (error.testName) {
      parts.push(...messageLines.map((line) => `    ${line}`));
    } else {
      parts.push(...messageLines);
    }

    lines.push(...parts);

    // Add spacing between errors
    lines.push("");
  }

  return lines;
}

// Re-export types for convenience
export type { ExtractionResult, ExtractedError, TestFramework } from "./types.js";
