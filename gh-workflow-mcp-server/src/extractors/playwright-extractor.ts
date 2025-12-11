/**
 * Playwright test framework extractor - parses JSON output only
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from './types.js';

interface PlaywrightJsonReport {
  config?: any; // Config object (optional, may not be present in all reports)
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
  readonly name = 'playwright' as const;

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
            framework: 'playwright',
            confidence: 'high',
            isJsonOutput: true,
          };
        }
      } catch (err) {
        // Not valid JSON or extraction failed
        console.error(
          `[DEBUG] JSON parsing failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Check for Playwright config JSON (indicates timeout during execution)
    // This happens when Playwright is killed before tests run
    if (/"config":\s*{/.test(logText) && /"configFile":/.test(logText)) {
      return {
        framework: 'playwright',
        confidence: 'high',
        isJsonOutput: false,
        isTimeout: true,
      };
    }

    // Sample first 200 lines for text detection
    const lines = logText.split('\n');
    const sampleSize = Math.min(200, lines.length);
    let playwrightMarkerCount = 0;

    for (let i = 0; i < sampleSize; i++) {
      const line = lines[i];

      // Check for Playwright-specific markers (line reporter)
      if (
        /[✘✓]/.test(line) ||
        /\u2718|\u2714/.test(line) || // Unicode checkmarks
        /\[chromium\]|\[firefox\]|\[webkit\]/.test(line) ||
        /Error: expect\(/i.test(line) ||
        /›.*\.spec\.(ts|js):\d+/.test(line) ||
        /Running.*global.*setup/i.test(line) ||
        /npx playwright test/i.test(line)
      ) {
        playwrightMarkerCount++;
      }
    }

    // Detected Playwright but not JSON format - wrong reporter
    if (playwrightMarkerCount >= 3) {
      return {
        framework: 'playwright',
        confidence: 'high',
        isJsonOutput: false,
      };
    }

    // Medium confidence with at least one marker
    if (playwrightMarkerCount > 0) {
      return {
        framework: 'playwright',
        confidence: 'medium',
        isJsonOutput: false,
      };
    }

    return null;
  }

  extract(logText: string, maxErrors = 10): ExtractionResult {
    const detection = this.detect(logText);

    // Handle timeout case (config JSON without test results)
    if (detection?.isTimeout) {
      return this.parsePlaywrightTimeout(logText);
    }

    if (detection?.isJsonOutput) {
      return this.parsePlaywrightJson(logText, maxErrors);
    } else if (detection) {
      // Playwright detected but wrong reporter format
      return {
        framework: 'playwright',
        errors: [
          {
            message:
              'Playwright tests detected but logs are not in JSON format. Please configure Playwright to use the JSON reporter.',
            rawOutput: [
              'To fix this, update your Playwright configuration:',
              '',
              'In playwright.config.ts/js, add:',
              "  reporter: [['json', { outputFile: 'results.json' }]]",
              '',
              'Or use the --reporter=json flag:',
              '  npx playwright test --reporter=json',
              '',
              "Current logs appear to be using the 'line' or 'list' reporter.",
            ],
          },
        ],
      };
    }

    // No Playwright detected at all
    return {
      framework: 'unknown',
      errors: [],
    };
  }

  private parsePlaywrightTimeout(logText: string): ExtractionResult {
    const lines = logText.split('\n');

    // Look for global setup completion to confirm tests were about to run
    let globalSetupComplete = false;
    let webServerCommand: string | undefined;
    let timeGap: number | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/global.*setup.*complete/i.test(line)) {
        globalSetupComplete = true;
      }

      // Extract webServer command if present
      if (/command.*http-server|npm run dev/i.test(line)) {
        webServerCommand = line.trim();
      }

      // Try to detect time gap (when config JSON appears long after global setup)
      if (globalSetupComplete && /"config":\s*{/.test(line)) {
        // Config JSON appeared - this indicates timeout during test execution
        const setupMatch = lines
          .slice(0, i)
          .reverse()
          .find((l) => /global.*setup.*complete/i.test(l));
        if (setupMatch) {
          // Extract timestamps if possible to show time gap
          const setupTimeMatch = setupMatch.match(/(\d{2}:\d{2}:\d{2})/);
          const configTimeMatch = line.match(/(\d{2}:\d{2}:\d{2})/);
          if (setupTimeMatch && configTimeMatch) {
            const setupTime = setupTimeMatch[1];
            const configTime = configTimeMatch[1];
            timeGap = this.parseTimeDiff(setupTime, configTime);
          }
        }
      }
    }

    // Build helpful error message
    let message = 'Playwright was interrupted during test execution. ';

    if (globalSetupComplete) {
      message += 'Global setup completed successfully but no test results were produced. ';
    }

    if (timeGap && timeGap > 60) {
      message += `There was a ${Math.floor(timeGap / 60)} minute gap before termination, `;
      message += 'suggesting the webServer failed to start or tests hung. ';
    }

    message +=
      '\n\nCommon causes:\n' +
      '  • webServer port already in use (check for port conflicts)\n' +
      '  • webServer failed to bind to specified port\n' +
      '  • webServer command failed silently\n' +
      '  • Test timeout exceeded\n' +
      '\n' +
      'Debug steps:\n' +
      '  1. Check if the port is available in the test environment\n' +
      '  2. Try using a different port\n' +
      '  3. Check webServer logs for binding errors\n' +
      '  4. Increase timeout if tests are legitimately slow';

    if (webServerCommand) {
      message += `\n\nwebServer command: ${webServerCommand}`;
    }

    return {
      framework: 'playwright',
      errors: [
        {
          message,
          failureType: 'timeout',
          rawOutput: lines.slice(-50), // Include last 50 lines for context
        },
      ],
      summary: 'Playwright timeout (no tests executed)',
    };
  }

  /**
   * Parse time difference between two HH:MM:SS strings
   * Returns difference in seconds
   */
  private parseTimeDiff(time1: string, time2: string): number {
    const parse = (t: string) => {
      const [h, m, s] = t.split(':').map(Number);
      return h * 3600 + m * 60 + s;
    };
    return Math.abs(parse(time2) - parse(time1));
  }

  private parsePlaywrightJson(logText: string, _maxErrors: number): ExtractionResult {
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

      const summary =
        totalFailed > 0 ? `${totalFailed} failed, ${totalPassed} passed` : `${totalPassed} passed`;

      return {
        framework: 'playwright',
        errors: failures,
        summary,
      };
    } catch (err) {
      // JSON parsing failed
      return {
        framework: 'playwright',
        errors: [
          {
            message: `Failed to parse Playwright JSON report: ${err instanceof Error ? err.message : String(err)}`,
            rawOutput: [logText.substring(0, 500)],
          },
        ],
      };
    }
  }

  /**
   * Extract JSON blob from logs that may contain other output
   * Looks for a JSON object that has "config" or "suites" as top-level keys
   */
  private extractJsonFromLogs(logText: string): string {
    const lines = logText.split('\n');

    // Strip GitHub Actions timestamps from each line
    const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /;
    const cleanLines = lines.map((line) => line.replace(timestampPattern, ''));

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
