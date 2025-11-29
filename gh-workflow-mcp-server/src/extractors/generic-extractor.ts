/**
 * Generic fallback extractor - uses FAILURE_PATTERNS for unknown frameworks
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from "./types.js";
import { FAILURE_PATTERNS } from "../constants.js";

export class GenericExtractor implements FrameworkExtractor {
  readonly name = "generic" as const;

  detect(logText: string): DetectionResult | null {
    // Generic extractor always matches as a fallback
    // Check if there are any failure patterns in the text
    const hasFailurePatterns = FAILURE_PATTERNS.some((pattern) =>
      pattern.test(logText)
    );

    if (hasFailurePatterns) {
      return {
        framework: "generic",
        confidence: "low",
        isJsonOutput: false,
      };
    }

    // Even if no patterns match, still return low confidence
    // This ensures we always have a fallback
    return {
      framework: "generic",
      confidence: "low",
      isJsonOutput: false,
    };
  }

  extract(logText: string, maxErrors = 10): ExtractionResult {
    const lines = logText.split("\n");
    const failureLineIndices: number[] = [];

    // First pass: find ALL lines matching failure patterns
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isFailureLine = FAILURE_PATTERNS.some((pattern) => pattern.test(line));
      if (isFailureLine) {
        failureLineIndices.push(i);
      }
    }

    // No failures found
    if (failureLineIndices.length === 0) {
      return {
        framework: "generic",
        errors: [],
      };
    }

    // Second pass: collect errors with context around each failure
    const errors: ExtractedError[] = [];
    const seenIndices = new Set<number>();

    for (const failureIdx of failureLineIndices) {
      // Capture context: 5 lines before, 5 lines after
      const contextStart = Math.max(0, failureIdx - 5);
      const contextEnd = Math.min(lines.length, failureIdx + 6);

      const contextLines: string[] = [];
      for (let j = contextStart; j < contextEnd; j++) {
        if (!seenIndices.has(j)) {
          seenIndices.add(j);
          const line = lines[j].trim();
          if (line) {
            contextLines.push(lines[j]); // Keep original formatting
          }
        }
      }

      // Use the failure line as the message
      const message = lines[failureIdx].trim();

      // Try to extract file:line references
      const fileLineMatch = message.match(/([a-zA-Z0-9_-]+\.(go|ts|js|py|java|rb)):(\d+)/);
      const fileName = fileLineMatch?.[1];
      const lineNumber = fileLineMatch?.[3] ? parseInt(fileLineMatch[3], 10) : undefined;

      errors.push({
        fileName,
        lineNumber,
        message,
        context: contextLines,
      });

      if (errors.length >= maxErrors) {
        break;
      }
    }

    // Try to extract summary
    let summary: string | undefined;
    const summaryPattern = /(\d+)\s+failed.*(\d+)\s+passed/i;

    for (const line of lines) {
      const match = line.match(summaryPattern);
      if (match) {
        summary = `${match[1]} failed, ${match[2]} passed`;
        break;
      }
    }

    // Alternative: just count failed pattern
    if (!summary) {
      const failedPattern = /(\d+)\s+failed/i;
      for (const line of lines) {
        const match = line.match(failedPattern);
        if (match) {
          summary = `${match[1]} failed`;
          break;
        }
      }
    }

    return {
      framework: "generic",
      errors,
      summary,
    };
  }
}
