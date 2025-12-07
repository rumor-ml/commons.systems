/**
 * Framework extractor registry and orchestration
 */

import type { ExtractionResult, FrameworkExtractor } from './types.js';
import { GoExtractor } from './go-extractor.js';
import { PlaywrightExtractor } from './playwright-extractor.js';
import { TapExtractor } from './tap-extractor.js';

// Registry of extractors in priority order
const extractors: FrameworkExtractor[] = [
  new GoExtractor(),
  new PlaywrightExtractor(),
  new TapExtractor(),
];

/**
 * Extract errors from logs using framework-specific extractors
 * Returns the result from the first high-confidence match
 * If no framework matches, returns an error indicating unknown format
 */
export function extractErrors(logText: string, maxErrors = 10): ExtractionResult {
  // Try each extractor in order, use first high-confidence match
  for (const extractor of extractors) {
    const detection = extractor.detect(logText);
    if (detection?.confidence === 'high') {
      return extractor.extract(logText, maxErrors);
    }
  }

  // No high-confidence match - return error
  return {
    framework: 'unknown',
    errors: [
      {
        message: 'Could not detect test framework. No known test output patterns found.',
        rawOutput: logText.split('\n').slice(0, 20), // First 20 lines for context
      },
    ],
  };
}

/**
 * Format extraction result into human-readable text
 */
export function formatExtractionResult(result: ExtractionResult): string[] {
  const lines: string[] = [];

  if (result.errors.length === 0) {
    return ['No errors detected'];
  }

  for (const error of result.errors) {
    // Format error header
    const parts: string[] = [];

    if (error.testName) {
      parts.push(`--- FAIL: ${error.testName}`);
    }

    if (error.fileName) {
      let location = error.fileName;
      if (error.lineNumber) {
        location += `:${error.lineNumber}`;
        if (error.columnNumber) {
          location += `:${error.columnNumber}`;
        }
      }
      parts.push(`    Location: ${location}`);
    }

    if (error.duration) {
      parts.push(`    Duration: ${error.duration}ms`);
    }

    if (error.failureType) {
      parts.push(`    Type: ${error.failureType}`);
    }

    if (error.errorCode) {
      parts.push(`    Code: ${error.errorCode}`);
    }

    // Add error message (indented if there's a test name)
    const messageLines = error.message.split('\n');
    if (error.testName) {
      parts.push(...messageLines.map((line) => `    ${line}`));
    } else {
      parts.push(...messageLines);
    }

    // Add stack trace if available
    if (error.stack) {
      parts.push('    Stack trace:');
      const stackLines = error.stack.split('\n');
      parts.push(...stackLines.map((line) => `      ${line}`));
    }

    // Add code snippet if available (Playwright)
    if (error.codeSnippet) {
      parts.push('    Code snippet:');
      const snippetLines = error.codeSnippet.split('\n');
      parts.push(...snippetLines.map((line) => `      ${line}`));
    }

    lines.push(...parts);

    // Add spacing between errors
    lines.push('');
  }

  return lines;
}

// Re-export types for convenience
export type { ExtractionResult, ExtractedError, TestFramework } from './types.js';
