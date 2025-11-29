/**
 * Playwright test framework extractor - parses text output
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from "./types.js";

export class PlaywrightExtractor implements FrameworkExtractor {
  readonly name = "playwright" as const;

  detect(logText: string): DetectionResult | null {
    const lines = logText.split("\n");
    let playwrightMarkerCount = 0;

    // Sample first 200 lines for detection
    const sampleSize = Math.min(200, lines.length);

    for (let i = 0; i < sampleSize; i++) {
      const line = lines[i];

      // Check for Playwright-specific markers
      if (
        /[✘✓]/.test(line) ||
        /\u2718/.test(line) || // ✘ unicode
        /\[chromium\]|\[firefox\]|\[webkit\]/.test(line) ||
        /Error: expect\(/i.test(line) ||
        /›.*\.spec\.(ts|js):\d+/.test(line)
      ) {
        playwrightMarkerCount++;
      }
    }

    // High confidence if we see multiple Playwright markers
    if (playwrightMarkerCount >= 3) {
      return {
        framework: "playwright",
        confidence: "high",
        isJsonOutput: false,
      };
    }

    // Medium confidence with at least one marker
    if (playwrightMarkerCount > 0) {
      return {
        framework: "playwright",
        confidence: "medium",
        isJsonOutput: false,
      };
    }

    return null;
  }

  extract(logText: string, maxErrors = 10): ExtractionResult {
    const lines = logText.split("\n");
    const failures: ExtractedError[] = [];

    // Playwright failure line format:
    // ✘ N [browser] › file.spec.ts:line › test name (duration)
    // We capture everything up to the optional duration in parentheses
    const failPattern = /^\s*[✘\u2718].*\[([^\]]+)\].*›\s*(.+\.spec\.(ts|js)):(\d+).*›\s*(.+?)(?:\s*\(\d+(?:ms|s)\))?$/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(failPattern);
      if (match) {
        const browser = match[1];
        const fileName = match[2];
        const lineNumber = parseInt(match[4], 10);
        const testName = match[5].trim();

        // Collect error context until next test or end
        const contextLines: string[] = [];
        let errorMessage = "Test failed";

        for (let j = i + 1; j < lines.length && j < i + 20; j++) {
          const line = lines[j];

          // Stop at next test marker
          if (failPattern.test(line) || /^\s*[✓\u2714]/.test(line)) {
            break;
          }

          // Collect non-empty lines
          if (line.trim()) {
            contextLines.push(line);

            // Extract error message from expect() or Error: lines
            if (!errorMessage || errorMessage === "Test failed") {
              if (/Error: expect\(/i.test(line)) {
                errorMessage = line.trim();
              } else if (/Error:/i.test(line)) {
                errorMessage = line.trim();
              }
            }
          }
        }

        // Use first context line as message if we didn't find an explicit error
        if (errorMessage === "Test failed" && contextLines.length > 0) {
          errorMessage = contextLines[0];
        }

        failures.push({
          testName: `[${browser}] ${testName}`,
          fileName,
          lineNumber,
          message: errorMessage,
          context: contextLines.slice(0, 10),
        });

        if (failures.length >= maxErrors) break;
      }
    }

    // Try to extract summary
    let summary: string | undefined;
    const summaryPattern = /(\d+)\s+failed.*(\d+)\s+passed/i;

    // Search from end for summary
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
      const match = lines[i].match(summaryPattern);
      if (match) {
        summary = `${match[1]} failed, ${match[2]} passed`;
        break;
      }
    }

    // Alternative summary patterns
    if (!summary) {
      const failedPattern = /(\d+)\s+failed/i;
      const passedPattern = /(\d+)\s+passed/i;
      let failed: string | null = null;
      let passed: string | null = null;

      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
        if (!failed && failedPattern.test(lines[i])) {
          const match = lines[i].match(failedPattern);
          if (match) failed = match[1];
        }
        if (!passed && passedPattern.test(lines[i])) {
          const match = lines[i].match(passedPattern);
          if (match) passed = match[1];
        }
        if (failed && passed) {
          summary = `${failed} failed, ${passed} passed`;
          break;
        }
      }

      if (!summary && failed) {
        summary = `${failed} failed`;
      }
    }

    return {
      framework: "playwright",
      errors: failures,
      summary,
    };
  }
}
