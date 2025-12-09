/**
 * Playwright test framework extractor - parses JSON and text output
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from './types.js';

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
  readonly name = 'playwright' as const;

  detect(logText: string): DetectionResult | null {
    const lines = logText.split('\n');
    let playwrightMarkerCount = 0;

    // Check for JSON format first
    const trimmed = logText.trim();
    if (trimmed.startsWith('{"suites":')) {
      try {
        JSON.parse(trimmed);
        return {
          framework: 'playwright',
          confidence: 'high',
          isJsonOutput: true,
        };
      } catch {
        // Not valid JSON, continue with text detection
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
    const sampleSize = Math.min(200, lines.length);

    for (let i = 0; i < sampleSize; i++) {
      const line = lines[i];

      // Check for Playwright-specific markers
      if (
        /[✘✓]/.test(line) ||
        /\u2718/.test(line) || // ✘ unicode
        /\[chromium\]|\[firefox\]|\[webkit\]/.test(line) ||
        /Error: expect\(/i.test(line) ||
        /›.*\.spec\.(ts|js):\d+/.test(line) ||
        /Running.*global.*setup/i.test(line) ||
        /npx playwright test/i.test(line)
      ) {
        playwrightMarkerCount++;
      }
    }

    // High confidence if we see multiple Playwright markers
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
    } else {
      return this.parsePlaywrightText(logText, maxErrors);
    }
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
    } catch (err) {
      // If JSON parsing fails, fall back to text parsing
      return this.parsePlaywrightText(logText, maxErrors);
    }

    return {
      framework: 'playwright',
      errors: failures,
      summary: failures.length > 0 ? `${failures.length} failed` : undefined,
    };
  }

  private parsePlaywrightText(logText: string, maxErrors: number): ExtractionResult {
    const lines = logText.split('\n');
    const failures: ExtractedError[] = [];

    // Playwright failure line format:
    // ✘ N [browser] › file.spec.ts:line › test name (duration)
    // We capture everything up to the optional duration in parentheses
    const failPattern =
      /^\s*[\u2718].*\[([^\]]+)\].*›\s*(.+\.spec\.(ts|js)):(\d+).*›\s*(.+?)(?:\s*\(\d+(?:ms|s)\))?$/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(failPattern);
      if (match) {
        const browser = match[1];
        const fileName = match[2];
        const lineNumber = parseInt(match[4], 10);
        const testName = match[5].trim();

        // Collect error context until next test or end
        const rawOutput: string[] = [];
        let errorMessage = 'Test failed';
        let stack: string | undefined;

        for (let j = i + 1; j < lines.length && j < i + 20; j++) {
          const line = lines[j];

          // Stop at next test marker
          if (failPattern.test(line) || /^\s*[✓\u2714]/.test(line)) {
            break;
          }

          // Collect non-empty lines
          if (line.trim()) {
            rawOutput.push(line);

            // Extract error message from expect() or Error: lines
            if (!errorMessage || errorMessage === 'Test failed') {
              if (/Error: expect\(/i.test(line)) {
                errorMessage = line.trim();
              } else if (/Error:/i.test(line)) {
                errorMessage = line.trim();
              }
            }

            // Build stack trace from error lines
            if (line.trim().startsWith('at ')) {
              if (!stack) stack = '';
              stack += (stack ? '\n' : '') + line.trim();
            }
          }
        }

        // Use first raw output line as message if we didn't find an explicit error
        if (errorMessage === 'Test failed' && rawOutput.length > 0) {
          errorMessage = rawOutput[0];
        }

        failures.push({
          testName: `[${browser}] ${testName}`,
          fileName,
          lineNumber,
          message: errorMessage,
          stack,
          rawOutput,
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
      framework: 'playwright',
      errors: failures,
      summary,
    };
  }
}
