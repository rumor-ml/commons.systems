/**
 * Prettier-specific error extractor
 *
 * Handles formatting errors from prettier with high precision by:
 * - Detecting prettier-specific output patterns
 * - Extracting file paths from diffs
 * - Capturing diff hunks showing formatting changes
 *
 * This extractor returns high confidence only when prettier patterns are detected,
 * avoiding false positives from other error types.
 */

import type {
  ExtractionResult,
  FrameworkExtractor,
  DetectionResult,
  ExtractedError,
} from './types.js';
import { safeValidateExtractedError, ValidationErrorTracker } from './types.js';

export class PrettierExtractor implements FrameworkExtractor {
  readonly name = 'unknown' as const; // Still 'unknown' since it's not a test framework

  /**
   * Detect Prettier formatting errors from log output
   *
   * Searches for Prettier-specific patterns including formatting check messages,
   * diff markers, and code style warnings. Returns high confidence when multiple
   * Prettier markers are present.
   *
   * @param logText - Raw log text to analyze
   * @returns Detection result with confidence level, or null if not Prettier
   *
   * @example
   * // Detect Prettier formatting check failure
   * const result = detect(logContainingPrettierErrors);
   * // Returns: { framework: 'unknown', confidence: 'high', isJsonOutput: false }
   */
  detect(logText: string): DetectionResult | null {
    // Detect prettier with HIGH confidence when we see formatting check patterns
    const hasPrettierCheck = /Checking formatting/i.test(logText);
    const hasDiffMarkers = /@@ -\d+,\d+ \+\d+,\d+ @@/.test(logText);
    const hasCodeStyleMessage = /Code style issues found|Forgot to run Prettier/i.test(logText);

    if (hasPrettierCheck || (hasDiffMarkers && hasCodeStyleMessage)) {
      return {
        framework: 'unknown',
        confidence: 'high', // High confidence for prettier-specific patterns
        isJsonOutput: false,
      };
    }

    return null; // Not a prettier error
  }

  /**
   * Extract formatting errors from Prettier logs
   *
   * Parses Prettier diff output to identify files with formatting issues. Extracts
   * file paths, diff hunks, and formatting violations. Handles both detailed diffs
   * and summary error messages.
   *
   * @param logText - Raw log text containing Prettier output
   * @param maxErrors - Maximum number of file errors to extract (default: 10)
   * @returns Extraction result with file paths and formatting diffs
   *
   * @example
   * // Extract formatting errors from Prettier check
   * const result = extract(logWithPrettierDiffs, 5);
   * // Returns errors with fileName, message, and rawOutput containing diff hunks
   */
  extract(logText: string, maxErrors = 10): ExtractionResult {
    const lines = logText.split('\n').map((line) => this.stripTimestamp(line));
    const errors: ExtractedError[] = [];
    const validationTracker = new ValidationErrorTracker();

    // Find files with formatting issues
    let currentFile: string | null = null;
    let currentDiff: string[] = [];
    let inDiffHunk = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect file paths (typically shown before diffs or in error messages)
      const fileMatch = line.match(/^([^\s]+\.(?:ts|js|jsx|tsx|md|json|yaml|yml))/);
      if (fileMatch) {
        // Save previous file's diff if any
        if (currentFile && currentDiff.length > 0) {
          const validatedError = safeValidateExtractedError(
            {
              fileName: currentFile,
              message: `Formatting issues in ${currentFile}`,
              rawOutput: currentDiff,
            },
            currentFile,
            validationTracker
          );
          errors.push(validatedError);
        }

        currentFile = fileMatch[1];
        currentDiff = [];
        inDiffHunk = false;
      }

      // Detect diff hunk headers
      if (line.match(/^@@ -\d+,\d+ \+\d+,\d+ @@/)) {
        inDiffHunk = true;
        currentDiff.push(line);
        continue;
      }

      // Capture diff content (lines starting with +, -, or context)
      if (inDiffHunk && (line.match(/^[+\- ]/) || line.trim() === '')) {
        currentDiff.push(line);

        // End diff on empty line or new section
        if (line.trim() === '' && i + 1 < lines.length && !lines[i + 1].match(/^[+\- @]/)) {
          inDiffHunk = false;
        }
      }

      // Detect "Code style issues found" summary
      if (line.match(/Code style issues found|Forgot to run Prettier/i)) {
        if (currentFile && currentDiff.length > 0) {
          const validatedError = safeValidateExtractedError(
            {
              fileName: currentFile,
              message: `Formatting issues in ${currentFile}`,
              rawOutput: currentDiff,
            },
            currentFile,
            validationTracker
          );
          errors.push(validatedError);
          currentFile = null;
          currentDiff = [];
        }
      }
    }

    // Don't forget last file
    if (currentFile && currentDiff.length > 0) {
      const validatedError = safeValidateExtractedError(
        {
          fileName: currentFile,
          message: `Formatting issues in ${currentFile}`,
          rawOutput: currentDiff,
        },
        currentFile,
        validationTracker
      );
      errors.push(validatedError);
    }

    // If no specific files found but we detected prettier, return the whole log
    if (errors.length === 0 && this.detect(logText)?.confidence === 'high') {
      const validatedError = safeValidateExtractedError(
        {
          message: 'Prettier formatting check failed',
          rawOutput: lines.slice(-100), // Last 100 lines as fallback
        },
        'fallback',
        validationTracker
      );

      return {
        framework: 'unknown',
        errors: [validatedError],
        parseWarnings: validationTracker.getSummaryWarning(),
      };
    }

    const parseWarnings = validationTracker.getSummaryWarning();

    return {
      framework: 'unknown',
      errors: errors.slice(0, maxErrors),
      parseWarnings,
    };
  }

  /**
   * Strip GitHub Actions timestamp prefix from log lines
   * Format: "2025-12-13T03:42:57.4595801Z "
   */
  private stripTimestamp(line: string): string {
    const match = line.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+/);
    return match ? line.slice(match[0].length) : line;
  }
}
