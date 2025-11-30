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
  config?: any;  // Config object (optional, may not be present in all reports)
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
    // Check for JSON format (may be embedded in logs)
    // Look for Playwright JSON structure markers
    const hasConfig = logText.includes('"config":');
    const hasSuites = logText.includes('"suites":');
    console.error(`[DEBUG] Playwright detect: hasConfig=${hasConfig}, hasSuites=${hasSuites}`);

    if (hasConfig && hasSuites) {
      try {
        const jsonText = this.extractJsonFromLogs(logText);
        console.error(`[DEBUG] Extracted JSON length: ${jsonText.length}`);
        const parsed = JSON.parse(jsonText);
        console.error(`[DEBUG] JSON parsed successfully, has suites: ${!!parsed.suites}`);
        if (parsed.suites && Array.isArray(parsed.suites)) {
          return {
            framework: "playwright",
            confidence: "high",
            isJsonOutput: true,
          };
        }
      } catch (err) {
        // Not valid JSON or extraction failed
        console.error(`[DEBUG] JSON parsing failed: ${err instanceof Error ? err.message : String(err)}`);
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

  extract(logText: string, _maxErrors = 10): ExtractionResult {
    const detection = this.detect(logText);

    if (detection?.isJsonOutput) {
      return this.parsePlaywrightJson(logText);
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

  private parsePlaywrightJson(logText: string): ExtractionResult {
    const failures: ExtractedError[] = [];

    try {
      // Extract JSON from logs - it may be embedded within other output
      const jsonText = this.extractJsonFromLogs(logText);
      const report = JSON.parse(jsonText) as PlaywrightJsonReport;

      const extractFromSuite = (suite: PlaywrightSuite) => {
        for (const spec of suite.specs || []) {
          if (!spec.ok) {
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
                }
              }
            }
          }
        }

        // Recursively process nested suites
        for (const nestedSuite of suite.suites || []) {
          extractFromSuite(nestedSuite);
        }
      };

      for (const suite of report.suites || []) {
        extractFromSuite(suite);
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

  /**
   * Extract JSON blob from logs that may contain other output
   * Looks for a JSON object that has "config" or "suites" as top-level keys
   */
  private extractJsonFromLogs(logText: string): string {
    const lines = logText.split("\n");

    // Strip GitHub Actions timestamps from each line
    const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /;
    const cleanLines = lines.map(line => line.replace(timestampPattern, ''));

    // Find start of JSON - look for standalone { followed by "config" or "suites"
    let jsonStart = -1;
    for (let i = 0; i < cleanLines.length; i++) {
      if (cleanLines[i].trim() === '{') {
        // Check if next few lines contain "config" or "suites"
        const nextFewLines = cleanLines.slice(i, Math.min(i + 20, cleanLines.length)).join('\n');
        if (nextFewLines.includes('"config":') || nextFewLines.includes('"suites":')) {
          jsonStart = i;
          break;
        }
      }
    }

    if (jsonStart === -1) {
      // Fallback: try parsing the whole thing
      return logText.trim();
    }

    // Try progressive parsing - keep adding lines until we have valid JSON
    // This handles nested braces in strings correctly
    for (let jsonEnd = jsonStart + 10; jsonEnd < cleanLines.length; jsonEnd++) {
      try {
        const candidate = cleanLines.slice(jsonStart, jsonEnd + 1).join('\n');
        const parsed = JSON.parse(candidate);
        // Successfully parsed and has the expected structure
        if (parsed.suites || parsed.config) {
          return candidate;
        }
      } catch {
        // Keep trying with more lines
      }
    }

    // Fallback: couldn't parse, return from start to end
    return cleanLines.slice(jsonStart).join('\n');
  }
}
