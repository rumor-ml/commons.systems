/**
 * Playwright test framework extractor - parses JSON output only
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from './types.js';
import { safeValidateExtractedError, ValidationErrorTracker } from './types.js';

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

    if (hasSuites) {
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
      return this.parsePlaywrightText(logText, maxErrors);
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
    let timeGap: number | null | undefined;
    let setupTimestamp: string | undefined;
    let configTimestamp: string | undefined;
    let timeDiagnostic: string | undefined;

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
            setupTimestamp = setupTimeMatch[1];
            configTimestamp = configTimeMatch[1];
            const timeResult = this.parseTimeDiff(setupTimestamp, configTimestamp);
            timeGap = timeResult.seconds;

            // Store diagnostic for inclusion in error message if parsing failed
            if (timeResult.seconds === null && timeResult.diagnostic) {
              timeDiagnostic = timeResult.diagnostic;
              console.error(
                `[WARN] parsePlaywrightTimeout: ${timeResult.diagnostic}. Continuing without time gap information.`
              );
            }
          }
        }
      }
    }

    // Build helpful error message
    let message = 'Playwright was interrupted during test execution. ';

    if (globalSetupComplete) {
      message += 'Global setup completed successfully but no test results were produced. ';
    }

    if (timeGap !== null && timeGap !== undefined && timeGap > 60) {
      message += `There was a ${Math.floor(timeGap / 60)} minute gap before termination, `;
      message += 'suggesting the webServer failed to start or tests hung. ';
    } else if (timeGap === null && timeDiagnostic) {
      // Include diagnostic directly in user-facing message
      message += `\n\nTimestamp diagnostic: ${timeDiagnostic}\n`;
      message += `This may indicate log format changes or timestamp extraction issues. `;
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

    const validationTracker = new ValidationErrorTracker();
    const validatedError = safeValidateExtractedError(
      {
        message,
        failureType: 'timeout',
        rawOutput: lines.slice(-50), // Include last 50 lines for context
      },
      'timeout error',
      validationTracker
    );

    return {
      framework: 'playwright',
      errors: [validatedError],
      summary: 'Playwright timeout (no tests executed)',
    };
  }

  /**
   * Parse a single HH:MM:SS timestamp string into seconds
   *
   * @param timestamp - Timestamp string in HH:MM:SS format
   * @param label - Descriptive label for error messages (e.g., "time1", "time2")
   * @returns Seconds since midnight, or null if parsing fails
   *
   * @example
   * parseTimestamp("12:30:45", "time1") // returns 45045
   * parseTimestamp("invalid", "time1")  // returns null (logs warning)
   */
  private parseTimestamp(timestamp: string, label: string): number | null {
    // Validate format is HH:MM:SS
    if (!/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
      console.error(
        `[WARN] parseTimestamp: ${label} has invalid format "${timestamp}" (expected HH:MM:SS)`
      );
      return null;
    }

    // Parse without try-catch - let unexpected errors propagate
    const [h, m, s] = timestamp.split(':').map(Number);

    // Check for NaN values (expected error - malformed input)
    if (isNaN(h) || isNaN(m) || isNaN(s)) {
      console.error(
        `[WARN] parseTimestamp: ${label} "${timestamp}" contains non-numeric values (h=${h}, m=${m}, s=${s})`
      );
      return null;
    }

    // Validate ranges (hours: 0-23, minutes/seconds: 0-59)
    const rangeErrors: string[] = [];
    if (h < 0 || h > 23) rangeErrors.push(`hours=${h} (valid: 0-23)`);
    if (m < 0 || m > 59) rangeErrors.push(`minutes=${m} (valid: 0-59)`);
    if (s < 0 || s > 59) rangeErrors.push(`seconds=${s} (valid: 0-59)`);

    if (rangeErrors.length > 0) {
      console.error(
        `[WARN] parseTimestamp: ${label} "${timestamp}" out-of-range: ${rangeErrors.join(', ')}`
      );
      return null;
    }

    return h * 3600 + m * 60 + s;
  }

  /**
   * Parse time difference between two HH:MM:SS strings
   *
   * Extracts timestamps from GitHub Actions logs to calculate time gaps
   * (e.g., between global setup completion and test execution timeout).
   *
   * FAILURE HANDLING:
   * - Returns structured result with optional diagnostic on failure
   * - Logs warnings for invalid formats or NaN values
   * - Caller conditionally includes diagnostic in error messages when available
   *
   * FAILURE CASES:
   * - Invalid format (not HH:MM:SS)
   * - NaN after parsing (e.g., "12:AB:34")
   * - Unexpected parsing errors
   *
   * @param time1 - First timestamp in HH:MM:SS format
   * @param time2 - Second timestamp in HH:MM:SS format
   * @returns Object with seconds (or null on failure) and optional diagnostic
   *
   * @example
   * parseTimeDiff("12:30:00", "12:35:30") // returns { seconds: 330 }
   * parseTimeDiff("invalid", "12:30:00")  // returns { seconds: null, diagnostic: "..." }
   */
  private parseTimeDiff(
    time1: string,
    time2: string
  ): {
    seconds: number | null;
    diagnostic?: string;
  } {
    const errors: string[] = [];

    const seconds1 = this.parseTimestamp(time1, 'time1');
    if (seconds1 === null) {
      errors.push(`time1 "${time1}" failed to parse`);
    }

    const seconds2 = this.parseTimestamp(time2, 'time2');
    if (seconds2 === null) {
      errors.push(`time2 "${time2}" failed to parse`);
    }

    if (seconds1 === null || seconds2 === null) {
      return {
        seconds: null,
        diagnostic: `Failed to parse timestamps: ${errors.join('; ')}`,
      };
    }

    const diff = Math.abs(seconds2 - seconds1);

    // TODO(#265): Add stderr logging for midnight rollover detection
    // Detect midnight rollover (gap > 12 hours = likely crossed midnight)
    if (diff > 43200) {
      return {
        seconds: null,
        diagnostic: `Midnight rollover detected: time1="${time1}" (${seconds1}s), time2="${time2}" (${seconds2}s), diff=${diff}s > 43200s (12h)`,
      };
    }

    return { seconds: diff };
  }

  /**
   * Parse Playwright JSON report from logs
   *
   * NOTE: The _maxErrors parameter is intentionally unused but retained for interface compatibility.
   * Unlike Go test JSON (which streams line-by-line and can be limited), Playwright JSON reports
   * are emitted as a single complete document at the end of test execution. The entire report
   * must be parsed to extract failures - there's no streaming or partial extraction.
   *
   * The _maxErrors parameter exists because:
   * 1. FrameworkExtractor interface requires it for consistency across extractors
   * 2. Go extractor uses it to limit line-by-line parsing overhead in massive logs
   * 3. Future extractors might support error limiting for other streaming formats
   * 4. Keeping the parameter maintains API compatibility if limiting becomes useful later
   *
   * @param logText - Full log text containing Playwright JSON report
   * @param _maxErrors - Unused; kept for FrameworkExtractor interface compatibility
   * @returns ExtractionResult with all failures found in the report
   */
  private parsePlaywrightJson(logText: string, _maxErrors: number): ExtractionResult {
    const failures: ExtractedError[] = [];
    const validationTracker = new ValidationErrorTracker();

    // Phase 1: Extract JSON from logs (let failure propagate for now)
    let jsonText: string;
    try {
      jsonText = this.extractJsonFromLogs(logText);
    } catch (extractErr) {
      // extractJsonFromLogs failed - no valid JSON structure found
      // TODO: See issue #332 - Include total log length, line count, and snippet from end of logs for better debugging
      console.error(
        `[ERROR] parsePlaywrightJson: JSON extraction from logs failed (no valid JSON structure found): ` +
          `${extractErr instanceof Error ? extractErr.message : String(extractErr)}`
      );
      const validatedError = safeValidateExtractedError(
        {
          message: `Failed to extract Playwright JSON from logs: ${extractErr instanceof Error ? extractErr.message : String(extractErr)}`,
          rawOutput: [logText.substring(0, 500)],
        },
        'JSON extraction error',
        validationTracker
      );
      return {
        framework: 'playwright',
        errors: [validatedError],
      };
    }

    // Phase 2: Parse JSON (narrow catch)
    let report: PlaywrightJsonReport;
    try {
      report = JSON.parse(jsonText) as PlaywrightJsonReport;
    } catch (parseErr) {
      // JSON.parse failed - malformed JSON after extraction
      console.error(
        `[ERROR] parsePlaywrightJson: JSON.parse failed after successful extraction: ` +
          `${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
      );
      console.error(`[DEBUG] First 200 chars of extracted JSON: ${jsonText.substring(0, 200)}`);
      const validatedError = safeValidateExtractedError(
        {
          message: `Failed to parse Playwright JSON report: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          rawOutput: [jsonText.substring(0, 500)],
        },
        'JSON parse error',
        validationTracker
      );
      return {
        framework: 'playwright',
        errors: [validatedError],
      };
    }

    // Phase 3: Traverse suites (NO catch - bugs should propagate)
    console.error(`[DEBUG] parsePlaywrightJson: parsed ${report.suites?.length || 0} suites`);

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

                // Ensure rawOutput has at least one element for schema validation
                if (rawOutput.length === 0) {
                  rawOutput.push('Test failed');
                }

                const testName = `[${test.projectName}] ${spec.title}`;
                const validatedError = safeValidateExtractedError(
                  {
                    testName,
                    fileName: suite.file,
                    lineNumber: suite.line,
                    columnNumber: suite.column > 0 ? suite.column : undefined, // Schema requires positive integers
                    message: error?.message || 'Test failed',
                    stack: error?.stack,
                    codeSnippet: error?.snippet,
                    duration: result.duration,
                    failureType: result.status,
                    rawOutput,
                  },
                  testName,
                  validationTracker
                );

                failures.push(validatedError);
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

    const parseWarnings = validationTracker.getSummaryWarning();

    return {
      framework: 'playwright',
      errors: failures,
      summary,
      parseWarnings,
    };
  }

  private parsePlaywrightText(logText: string, maxErrors: number): ExtractionResult {
    const lines = logText.split('\n');
    const failures: ExtractedError[] = [];
    let passed = 0;
    let failed = 0;
    const validationTracker = new ValidationErrorTracker();

    // Pattern: [✘✗] 1 [chromium] › file.spec.ts:123 › Test Name (100ms)
    const failPattern =
      /[✘✗]\s+\d+\s+\[(\w+)\]\s+›\s+([^:]+):(\d+)\s+›\s+(.+?)(?:\s+\((\d+)ms\))?$/;
    const passPattern = /[✓✔]\s+\d+/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const passMatch = line.match(passPattern);
      if (passMatch) {
        passed++;
        continue;
      }

      const failMatch = line.match(failPattern);
      if (failMatch && failures.length < maxErrors) {
        const projectName = failMatch[1];
        const fileName = failMatch[2];
        const lineNumber = parseInt(failMatch[3], 10);
        const testName = failMatch[4];
        const duration = failMatch[5] ? parseInt(failMatch[5], 10) : undefined;

        // Collect error output lines (typically indented after the fail line)
        const rawOutput: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          // Stop at next test marker or unindented line
          if (/^[✘✗✓✔]\s+\d+/.test(nextLine) || /^Running \d+ test/.test(nextLine)) {
            break;
          }
          if (nextLine.trim()) {
            rawOutput.push(nextLine);
          }
        }

        // Ensure rawOutput has at least one element for schema validation
        if (rawOutput.length === 0) {
          rawOutput.push(`Test failed: ${testName}`);
        }

        const fullTestName = `[${projectName}] ${testName}`;
        const validatedError = safeValidateExtractedError(
          {
            testName: fullTestName,
            fileName,
            lineNumber,
            message: rawOutput.join('\n').trim() || `Test failed: ${testName}`,
            duration,
            rawOutput,
          },
          fullTestName,
          validationTracker
        );

        failures.push(validatedError);
        failed++;
      }
    }

    const parseWarnings = validationTracker.getSummaryWarning();

    return {
      framework: 'playwright',
      errors: failures,
      summary: failed > 0 ? `${failed} failed, ${passed} passed` : undefined,
      parseWarnings,
    };
  }

  /**
   * Extract JSON blob from logs that may contain other output
   *
   * Playwright JSON reports are often embedded within GitHub Actions logs that contain
   * timestamps, build output, and other non-JSON content. This method uses a progressive
   * parsing strategy to locate and extract the complete JSON report.
   *
   * EXTRACTION STRATEGY:
   * 1. Strip GitHub Actions timestamps (YYYY-MM-DDTHH:MM:SS.nnnnnnnZ) from all lines
   *    Example: "2025-03-15T14:32:18.123456789Z {config: ...}" → "{config: ...}"
   * 2. Find JSON start marker: standalone "{" or line starting with '{"suites":'
   * 3. Verify next ~20 lines contain "config" or "suites" to confirm this is the report
   * 4. Progressively parse from start marker, adding lines until valid JSON with expected structure
   * 5. Fallback to entire log text if no marker found or parsing fails
   *
   * FALLBACK BEHAVIOR:
   * - If no JSON start marker found: logs warning, returns entire log text (may fail downstream)
   * - If progressive parsing fails: logs error with retry count, returns from marker to end
   * - Caller (parsePlaywrightJson) will catch JSON.parse errors and return error result
   *
   * WHY PROGRESSIVE PARSING:
   * - Handles nested braces in JSON strings correctly (regex-based brace counting would fail)
   * - Stops at first valid JSON, avoiding extra log content at end
   * - More robust than regex extraction for complex JSON structures
   *
   * @param logText - Raw log text containing Playwright JSON report
   * @returns Extracted JSON string ready for parsing
   */
  private extractJsonFromLogs(logText: string): string {
    const lines = logText.split('\n');

    // Strip GitHub Actions timestamps from each line
    const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /;
    const cleanLines = lines.map((line) => line.replace(timestampPattern, ''));

    // Find start of JSON - look for standalone { followed by "config" or "suites"
    let jsonStart = -1;
    for (let i = 0; i < cleanLines.length; i++) {
      const trimmedLine = cleanLines[i].trim();
      if (
        trimmedLine === '{' ||
        (trimmedLine.startsWith('{') && trimmedLine.includes('"suites":'))
      ) {
        // Check if next few lines contain "config" or "suites"
        const nextFewLines = cleanLines.slice(i, Math.min(i + 20, cleanLines.length)).join('\n');
        if (nextFewLines.includes('"config":') || nextFewLines.includes('"suites":')) {
          jsonStart = i;
          break;
        }
      }
    }

    if (jsonStart === -1) {
      // FALLBACK 1: No JSON start marker found
      // This happens when logs don't contain a recognizable Playwright JSON report
      // Caller will likely fail to parse, but we provide full context for debugging
      // TODO: See issue #332 - Validate fallback return value is parseable JSON before returning
      console.error(
        '[WARN] Playwright JSON extraction: No JSON start marker found. ' +
          'Expected standalone "{" followed by "config" or "suites" fields within ~20 lines. ' +
          'FALLBACK: Returning entire log text (will likely fail in JSON.parse). ' +
          `Log size: ${logText.length} chars, ${lines.length} lines`
      );
      return logText.trim();
    }

    // Try progressive parsing - keep adding lines until we have valid JSON
    // This handles nested braces in strings correctly
    let parseAttempts = 0;
    for (let jsonEnd = jsonStart + 10; jsonEnd < cleanLines.length; jsonEnd++) {
      try {
        const candidate = cleanLines.slice(jsonStart, jsonEnd + 1).join('\n');
        const parsed = JSON.parse(candidate);
        // Successfully parsed and has the expected structure
        if (parsed.suites || parsed.config) {
          if (parseAttempts > 0) {
            console.error(
              `[DEBUG] Playwright JSON extraction: Success after ${parseAttempts} parse attempts (jsonStart=${jsonStart}, jsonEnd=${jsonEnd}, total lines=${jsonEnd - jsonStart + 1})`
            );
          }
          return candidate;
        }
      } catch (parseErr) {
        // Keep trying with more lines
        // Log first few parse errors for diagnostics
        // TODO: See issue #332 - Only catch SyntaxError, let other exceptions propagate to expose bugs
        if (parseAttempts < 3) {
          console.error(
            `[DEBUG] extractJsonFromLogs: progressive parse attempt ${parseAttempts + 1} failed at jsonEnd=${jsonEnd}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
          );
        }
        parseAttempts++;
      }
    }

    // FALLBACK 2: Found JSON start marker but couldn't complete parsing
    // This indicates truncated or malformed JSON in the log output
    // TODO: See issue #332 - Validate fallback JSON or throw specific error for incomplete JSON
    const extractedLines = cleanLines.length - jsonStart;
    console.error(
      `[ERROR] Playwright JSON extraction: FALLBACK 2 after ${parseAttempts} parse attempts. ` +
        `Found JSON start at line ${jsonStart} but could not parse complete JSON. ` +
        `FALLBACK: Returning ${extractedLines} lines from jsonStart to end (may be incomplete/malformed). ` +
        `This likely indicates truncated or malformed JSON in logs. ` +
        `Expected "suites" or "config" fields but parsing never succeeded.`
    );
    return cleanLines.slice(jsonStart).join('\n');
  }
}
