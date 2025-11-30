/**
 * Playwright test framework extractor - parses JSON output only
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from "./types.js";

interface PlaywrightJsonReport {
  suites: PlaywrightSuite[];
}

interface PlaywrightSuite {
  title: string;
  file: string;
  column: number;
  line: number;
  specs: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tests: PlaywrightTest[];
}

interface PlaywrightTest {
  expectedStatus: string;
  status: string;
  projectName: string;
  results: PlaywrightTestResult[];
}

interface PlaywrightTestResult {
  duration: number;
  status: string;
  error?: {
    message: string;
    stack?: string;
    snippet?: string;
  };
}

export class PlaywrightExtractor implements FrameworkExtractor {
  readonly name = "playwright" as const;

  detect(logText: string): DetectionResult | null {
    // Check for JSON format
    const trimmed = logText.trim();
    if (trimmed.startsWith('{"suites":')) {
      try {
        JSON.parse(trimmed);
        return {
          framework: "playwright",
          confidence: "high",
          isJsonOutput: true,
        };
      } catch {
        // Not valid JSON
      }
    }

    // Check if this looks like Playwright output but using wrong reporter
    const lines = logText.split("\n");
    const sampleSize = Math.min(200, lines.length);
    let playwrightMarkerCount = 0;

    for (let i = 0; i < sampleSize; i++) {
      const line = lines[i];

      // Check for Playwright-specific markers (line reporter)
      if (
        /[✘✓]/.test(line) ||
        /\u2718|\u2714/.test(line) || // ✘ ✓ unicode
        /\[chromium\]|\[firefox\]|\[webkit\]/.test(line) ||
        /Error: expect\(/i.test(line) ||
        /›.*\.spec\.(ts|js):\d+/.test(line) ||
        /\d+\)\s+\[chromium\]|\[firefox\]|\[webkit\]/.test(line)
      ) {
        playwrightMarkerCount++;
      }
    }

    // Detected Playwright but not JSON format - wrong reporter
    if (playwrightMarkerCount >= 3) {
      return {
        framework: "playwright",
        confidence: "high",
        isJsonOutput: false,
      };
    }

    return null;
  }

  extract(logText: string, maxErrors = 10): ExtractionResult {
    const detection = this.detect(logText);

    if (detection?.isJsonOutput) {
      return this.parsePlaywrightJson(logText, maxErrors);
    } else if (detection) {
      // Playwright detected but wrong reporter format
      return {
        framework: "playwright",
        errors: [{
          message: "Playwright tests detected but logs are not in JSON format. Please configure Playwright to use the JSON reporter.",
          rawOutput: [
            "To fix this, update your Playwright configuration:",
            "",
            "In playwright.config.ts/js, add:",
            "  reporter: [['json', { outputFile: 'results.json' }]]",
            "",
            "Or use the --reporter=json flag:",
            "  npx playwright test --reporter=json",
            "",
            "Current logs appear to be using the 'line' or 'list' reporter.",
          ],
        }],
      };
    }

    // No Playwright detected at all
    return {
      framework: "unknown",
      errors: [],
    };
  }

  private parsePlaywrightJson(logText: string, maxErrors: number): ExtractionResult {
    const failures: ExtractedError[] = [];

    try {
      const report = JSON.parse(logText.trim()) as PlaywrightJsonReport;

      const extractFromSuite = (suite: PlaywrightSuite) => {
        for (const spec of suite.specs || []) {
          if (!spec.ok && failures.length < maxErrors) {
            for (const test of spec.tests || []) {
              for (const result of test.results || []) {
                if (result.status !== 'passed' && result.status !== 'skipped') {
                  const error = result.error;
                  const rawOutput: string[] = [];

                  if (error?.message) rawOutput.push(error.message);
                  if (error?.stack) rawOutput.push(error.stack);
                  if (error?.snippet) rawOutput.push(error.snippet);

                  failures.push({
                    testName: `[${test.projectName}] ${spec.title}`,
                    fileName: suite.file,
                    lineNumber: suite.line,
                    columnNumber: suite.column,
                    message: error?.message || 'Test failed',
                    stack: error?.stack,
                    codeSnippet: error?.snippet,
                    duration: result.duration,
                    failureType: result.status,
                    rawOutput,
                  });

                  if (failures.length >= maxErrors) return;
                }
              }
            }
          }
        }

        // Recursively process nested suites
        for (const nestedSuite of suite.suites || []) {
          extractFromSuite(nestedSuite);
          if (failures.length >= maxErrors) return;
        }
      };

      for (const suite of report.suites || []) {
        extractFromSuite(suite);
        if (failures.length >= maxErrors) break;
      }

      // Count total tests for summary
      let totalPassed = 0;
      let totalFailed = failures.length;

      const countTests = (suite: PlaywrightSuite) => {
        for (const spec of suite.specs || []) {
          if (spec.ok) {
            totalPassed += spec.tests.length;
          }
        }
        for (const nestedSuite of suite.suites || []) {
          countTests(nestedSuite);
        }
      };

      for (const suite of report.suites || []) {
        countTests(suite);
      }

      const summary = totalFailed > 0
        ? `${totalFailed} failed, ${totalPassed} passed`
        : `${totalPassed} passed`;

      return {
        framework: "playwright",
        errors: failures,
        summary,
      };
    } catch (err) {
      // JSON parsing failed
      return {
        framework: "playwright",
        errors: [{
          message: `Failed to parse Playwright JSON report: ${err instanceof Error ? err.message : String(err)}`,
          rawOutput: [logText.substring(0, 500)],
        }],
      };
    }
  }
}
