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

  /**
   * Detect Playwright test framework from log output
   *
   * Searches for Playwright JSON report structure in logs. Handles embedded
   * JSON within GitHub Actions logs by extracting and parsing JSON content.
   *
   * @param logText - Raw log text to analyze
   * @returns Detection result with confidence level, or null if not Playwright
   */
  detect(logText: string): DetectionResult | null {
    // Check for JSON format (may be embedded in logs)
    // Look for Playwright JSON structure markers
    const hasSuites = logText.includes('"suites":');

    if (hasSuites) {
      try {
        const jsonText = this.extractJsonFromLogs(logText);
        const parsed = JSON.parse(jsonText);
        if (parsed.suites && Array.isArray(parsed.suites)) {
          return {
            framework: 'playwright',
            confidence: 'high',
            isJsonOutput: true,
          };
        }
      } catch (err) {
        // Expected: SyntaxError or "No valid Playwright JSON" message
        if (
          err instanceof SyntaxError ||
          (err instanceof Error && err.message.includes('No valid Playwright JSON'))
        ) {
          return null; // Not Playwright - try other detectors
        }
        throw err; // Unexpected error - propagate bug
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

  /**
   * Extract test failures and errors from Playwright logs
   *
   * Handles both JSON and text output formats. For JSON, parses structured
   * test results. For text, uses pattern matching. Provides detailed error
   * context including file locations, error messages, and stack traces.
   *
   * @param logText - Raw log text containing Playwright output
   * @param maxErrors - Maximum number of errors to extract (default: 10)
   * @returns Extraction result with framework name, errors, and optional summary
   *   - Returns timeout error if JSON extraction fails (incomplete test execution)
   *   - Returns fallback error with context if JSON parsing fails
   *   - Continues extraction even if individual test suites are malformed
   */
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

    if (typeof timeGap === 'number' && timeGap > 60) {
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

    // Midnight rollover detection: 12h threshold (43200s)
    // Rationale: Valid test runs never exceed 12h; larger gaps = date boundary
    // See parseTimeDiff JSDoc for full documentation
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
   * Processes Playwright's JSON reporter output to extract test failures with full context.
   * Handles logs containing embedded JSON (e.g., GitHub Actions with timestamps).
   *
   * ERROR HANDLING PHASES:
   * 1. JSON Extraction (extractJsonFromLogs): Throws on no valid JSON structure found
   * 2. JSON Parsing (JSON.parse): Returns fallback error on malformed JSON
   * 3. Suite Traversal: No try-catch - bugs propagate (expected structure)
   *
   * FAILURE MODES:
   * - Extraction fails → Returns error with log size context
   * - Parse fails → Returns error with JSON snippet
   * - Traversal throws → Bug propagates (indicates schema change or extractor bug)
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
   * @throws Never throws - returns error result instead for user-facing errors
   *
   * @example
   * // Typical usage with embedded JSON
   * const logText = `
   * 2025-01-15T10:00:00.000Z Running tests...
   * 2025-01-15T10:00:01.000Z {"suites":[{"specs":[...]}]}
   * `;
   * const result = parsePlaywrightJson(logText, 10);
   * // Returns: { framework: 'playwright', errors: [...], summary: '2 failed, 8 passed' }
   */
  private parsePlaywrightJson(logText: string, _maxErrors: number): ExtractionResult {
    const failures: ExtractedError[] = [];
    const validationTracker = new ValidationErrorTracker();

    // Phase 1: Extract JSON from logs (let failure propagate for now)
    let jsonText: string;
    try {
      jsonText = this.extractJsonFromLogs(logText);
    } catch (extractErr) {
      const lines = logText.split('\n');
      const logStats = {
        totalChars: logText.length,
        totalLines: lines.length,
        firstLine: lines[0]?.substring(0, 100) || '(empty)',
        lastLine: lines[lines.length - 1]?.substring(0, 100) || '(empty)',
      };
      const endSnippet = lines.slice(-10).join('\n');

      console.error(
        `[ERROR] parsePlaywrightJson: JSON extraction failed.\n` +
          `  Error: ${extractErr instanceof Error ? extractErr.message : String(extractErr)}\n` +
          `  Log stats: ${logStats.totalChars} chars, ${logStats.totalLines} lines\n` +
          `  Last 10 lines:\n${endSnippet}`
      );

      const validatedError = safeValidateExtractedError(
        {
          message:
            `Failed to extract Playwright JSON from logs.\n\n` +
            `Error: ${extractErr instanceof Error ? extractErr.message : String(extractErr)}\n\n` +
            `Log statistics:\n` +
            `  - Total: ${logStats.totalChars} chars, ${logStats.totalLines} lines\n` +
            `  - First: ${logStats.firstLine}\n` +
            `  - Last: ${logStats.lastLine}\n\n` +
            `Common causes:\n` +
            `  1. Wrong reporter (use --reporter=json)\n` +
            `  2. Truncated output\n` +
            `  3. JSON generation failure\n\n` +
            `Last 10 lines:\n${endSnippet}`,
          rawOutput: [
            `First 500 chars: ${logText.substring(0, 500)}`,
            `Last 500 chars: ${logText.substring(Math.max(0, logText.length - 500))}`,
          ],
        },
        'JSON extraction error',
        validationTracker
      );

      return { framework: 'playwright', errors: [validatedError] };
    }

    // Phase 2: Parse JSON (narrow catch)
    let report: PlaywrightJsonReport;
    try {
      report = JSON.parse(jsonText) as PlaywrightJsonReport;
    } catch (parseErr) {
      // Only catch expected SyntaxError from JSON.parse
      if (!(parseErr instanceof SyntaxError)) {
        throw parseErr; // Unexpected error - propagate bug (OOM, internal V8 error, etc.)
      }
      // JSON.parse failed - malformed JSON after extraction
      console.error(`[ERROR] parsePlaywrightJson: JSON.parse failed: ${parseErr.message}`);
      const validatedError = safeValidateExtractedError(
        {
          message: `Failed to parse Playwright JSON report: ${parseErr.message}`,
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
      console.error('[WARN] Playwright JSON extraction: No JSON start marker found...');

      // Edge case: try parsing entire log
      try {
        const parsed = JSON.parse(logText.trim());
        if (parsed.suites || parsed.config) {
          console.error('[WARN] Entire log is valid Playwright JSON');
          return logText.trim();
        }
      } catch (err) {
        // Expected: SyntaxError if log is not valid JSON
        if (!(err instanceof SyntaxError)) {
          console.error(`[ERROR] Unexpected error parsing entire log: ${err}`);
          // Continue to throw Error below with diagnostic message
        }
      }

      throw new Error(
        `No valid Playwright JSON found in logs. ` +
          `Log contains ${lines.length} lines (${logText.length} chars). ` +
          `Expected JSON with "suites" or "config" fields. ` +
          `Use --reporter=json in playwright.config.ts`
      );
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
          return candidate;
        }
      } catch (parseErr) {
        if (!(parseErr instanceof SyntaxError)) {
          throw parseErr; // Other errors are bugs
        }
        // SyntaxError expected during progressive parsing
        if (parseAttempts < 3) {
          console.error(
            `[DEBUG] extractJsonFromLogs: progressive parse attempt ${parseAttempts + 1}...`
          );
        }
        parseAttempts++;
      }
    }

    // FALLBACK 2: Try parsing what we have
    const fallbackJson = cleanLines.slice(jsonStart).join('\n');
    try {
      JSON.parse(fallbackJson);
      console.error(`[WARN] Fallback JSON parsed after ${parseAttempts} attempts`);
      return fallbackJson;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(
          `Incomplete Playwright JSON after ${parseAttempts} attempts. ` +
            `Found start at line ${jsonStart} but parsing failed. ` +
            `SyntaxError: ${err.message}. Indicates truncated/malformed JSON.`
        );
      }
      throw err;
    }
  }
}
