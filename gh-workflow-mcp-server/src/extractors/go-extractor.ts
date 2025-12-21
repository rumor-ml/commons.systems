/**
 * Go test framework extractor - parses both JSON and text output
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from './types.js';
import { safeValidateExtractedError, ValidationErrorTracker } from './types.js';

interface GoTestEvent {
  Time: string;
  Action: 'run' | 'pass' | 'fail' | 'output' | 'skip' | 'pause' | 'cont';
  Package: string;
  Test?: string;
  Output?: string;
  Elapsed?: number; // Test duration in seconds
}

export class GoExtractor implements FrameworkExtractor {
  readonly name = 'go' as const;

  /**
   * Strip GitHub Actions timestamp prefix from a log line.
   * GitHub Actions logs are prefixed with timestamps like "2025-11-29T21:44:33.3461112Z "
   */
  private stripTimestamp(line: string): string {
    // Match ISO timestamp at start: YYYY-MM-DDTHH:MM:SS.nnnnnnnZ followed by space or tab
    const match = line.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z[\s\t]+/);
    return match ? line.slice(match[0].length) : line;
  }

  /**
   * Detect Go test framework from log output
   *
   * Searches for Go test JSON format (-json flag) or text format markers.
   * Handles GitHub Actions timestamp prefixes. Samples first 500 lines due
   * to Actions preamble.
   *
   * @param logText - Raw log text to analyze
   * @returns Detection result with confidence level and format type, or null if not Go
   */
  detect(logText: string): DetectionResult | null {
    const lines = logText.split('\n');
    let jsonLineCount = 0;
    let textMarkerCount = 0;

    // Sample first 500 lines for detection - GitHub Actions logs have significant
    // preamble (runner setup, checkout, etc.) before actual test output begins
    const sampleSize = Math.min(500, lines.length);

    for (let i = 0; i < sampleSize; i++) {
      const line = this.stripTimestamp(lines[i]);

      // Check for Go test JSON format
      if (line.startsWith('{') && line.includes('"Time"') && line.includes('"Action"')) {
        jsonLineCount++;
      }

      // Check for Go test text markers
      if (/^(---\s*(FAIL|PASS):|===\s*RUN|FAIL\t|PASS\t)/.test(line)) {
        textMarkerCount++;
      }
    }

    // High confidence if we see multiple JSON lines with Action field
    if (jsonLineCount >= 3) {
      return {
        framework: 'go',
        confidence: 'high',
        isJsonOutput: true,
      };
    }

    // Detected Go test text format (wrong reporter)
    if (textMarkerCount >= 2) {
      return {
        framework: 'go',
        confidence: 'high',
        isJsonOutput: false,
      };
    }

    // Medium confidence with at least one marker
    if (jsonLineCount > 0 || textMarkerCount > 0) {
      return {
        framework: 'go',
        confidence: 'medium',
        isJsonOutput: jsonLineCount > 0,
      };
    }

    return null;
  }

  /**
   * Extract test failures and errors from Go test logs
   *
   * Handles both JSON (-json flag) and text output formats. For JSON, parses
   * structured test events. For text, extracts failure messages using pattern
   * matching. Includes test summary statistics when available.
   *
   * @param logText - Raw log text containing Go test output
   * @param maxErrors - Maximum number of errors to extract (default: 10)
   * @returns Extraction result with framework name, errors, and summary statistics
   */
  extract(logText: string, maxErrors = 10): ExtractionResult {
    const detection = this.detect(logText);

    if (detection?.isJsonOutput) {
      return this.parseGoTestJson(logText, maxErrors);
    } else if (detection) {
      return this.parseGoTestText(logText, maxErrors);
    }

    // No Go tests detected
    return {
      framework: 'unknown',
      errors: [],
    };
  }

  private parseGoTestJson(logText: string, maxErrors = 10): ExtractionResult {
    const lines = logText.split('\n');
    const testOutputs = new Map<string, string[]>();
    const failures: ExtractedError[] = [];
    const testResults = new Map<string, 'pass' | 'fail'>();
    const testDurations = new Map<string, number>();
    let skippedNonJsonLines = 0;
    let testEventParseErrors = 0;
    const validationTracker = new ValidationErrorTracker();

    // ARCHITECTURAL PATTERN: Three-stage error handling with narrow catch scopes
    //
    // STAGE 1 (parseGoTestJson: JSON.parse loop): JSON.parse() wrapped in minimal try-catch
    //   - ONLY catches JSON syntax errors (malformed JSON)
    //   - Expected errors: build output, compilation messages, GitHub Actions logs
    //   - Action: Skip line and log diagnostics
    //
    // STAGE 2 (parseGoTestJson: Test event validation): Test event validation (NO catch - structural bugs propagate)
    //   - Validates parsed JSON has required test event fields (Time, Action, Package)
    //   - No catch block: bugs in field access should crash for debugging
    //   - Action: Skip non-test-event JSON
    //
    // STAGE 3 (parseGoTestJson/parseGoTestText: safeValidateExtractedError calls): Schema validation with fallback errors
    //   - safeValidateExtractedError() catches Zod validation errors
    //   - Creates fallback ExtractedError with diagnostics
    //   - Ensures we NEVER silently drop test failures
    //
    // This separation ensures:
    // 1. JSON syntax errors don't mask validation issues
    // 2. Validation errors get full diagnostic context (line number, raw JSON)
    // 3. Bugs in extraction code propagate for visibility (not caught accidentally)

    // Parse error samples for user visibility
    interface ParseErrorSample {
      lineSnippet: string; // First 200 chars
      errorMessage: string; // Parse error
      lineNumber: number; // Position in log
    }
    const parseErrorSamples: ParseErrorSample[] = [];
    const MAX_ERROR_SAMPLES = 3;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const rawLine = lines[lineIndex];
      const line = this.stripTimestamp(rawLine);
      if (!line.startsWith('{')) continue;

      // SECTION 1: Parse JSON (narrow catch scope - only catches JSON.parse errors)
      let event: GoTestEvent;
      try {
        event = JSON.parse(line) as GoTestEvent;
      } catch (parseError) {
        // ONLY handles JSON.parse() failures - EXPECTED
        // Expected: build output, compilation messages, GitHub Actions logs
        const looksLikeTestEvent =
          line.includes('"Time"') || line.includes('"Action"') || line.includes('"Package"');

        if (looksLikeTestEvent) {
          // CRITICAL: Test event JSON that failed to parse - always log prominently
          testEventParseErrors++;
          const lineSnippet = line.length > 200 ? line.substring(0, 200) + '...' : line;

          // Store sample for user visibility
          if (parseErrorSamples.length < MAX_ERROR_SAMPLES) {
            parseErrorSamples.push({
              lineSnippet,
              errorMessage: parseError instanceof Error ? parseError.message : String(parseError),
              lineNumber: lineIndex + 1,
            });
          }

          console.error(
            `[ERROR] Go extractor: failed to parse test event JSON\n` +
              `  Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}\n` +
              `  Line content: ${lineSnippet}`
          );
        } else {
          // Malformed JSON that doesn't look like a test event
          // This could be build output, dependency downloads, etc.
          skippedNonJsonLines++;
        }
        continue; // Skip this line
      }

      // SECTION 2: Validate test event structure (NO catch - bugs should propagate)
      if (!('Time' in event && 'Action' in event && 'Package' in event)) {
        // Valid JSON but not a test event - likely build output JSON
        skippedNonJsonLines++;
        continue;
      }

      // SECTION 3: Process event (NO catch - bugs should propagate)
      // Use a more specific key that includes both package and test
      // This ensures we don't mix up tests from different packages
      const key = event.Test ? `${event.Package}::${event.Test}` : event.Package;

      // Collect output lines for each test
      if (event.Action === 'output' && event.Output) {
        if (!testOutputs.has(key)) {
          testOutputs.set(key, []);
        }
        testOutputs.get(key)!.push(event.Output);
      }

      // Track test results and duration
      if (event.Action === 'fail' && event.Test) {
        testResults.set(key, 'fail');
        if (event.Elapsed !== undefined) {
          testDurations.set(key, event.Elapsed * 1000); // Convert to ms
        }
      } else if (event.Action === 'pass' && event.Test) {
        testResults.set(key, 'pass');
      }
    }

    if (skippedNonJsonLines > 0) {
      // Calculate percentage and assess severity
      const totalLines = lines.length;
      const skippedPercentage = (skippedNonJsonLines / totalLines) * 100;
      let assessment: string;
      let severity: 'DEBUG' | 'WARN';

      if (skippedPercentage > 50) {
        assessment = 'HIGH - Majority of lines skipped, likely wrong output format';
        severity = 'WARN';
      } else if (skippedPercentage > 20) {
        assessment = 'MODERATE - Significant non-JSON content, verify -json flag is set';
        severity = 'WARN';
      } else {
        assessment = 'NORMAL - Expected build output mixed with test JSON';
        severity = 'DEBUG';
      }

      console.error(
        `[${severity}] Go extractor: skipped ${skippedNonJsonLines} non-JSON lines during parsing (${skippedPercentage.toFixed(1)}% of ${totalLines} total lines). Assessment: ${assessment}`
      );
    }

    // Extract failures with their output
    for (const [key, result] of testResults.entries()) {
      // Stop if we've reached the maxErrors limit
      if (failures.length >= maxErrors) {
        break;
      }

      if (result === 'fail') {
        const outputs = testOutputs.get(key) || [];
        const fullOutput = outputs.join('');

        // Parse the test name from key (format: "package::testname")
        const parts = key.split('::');
        const testName = parts[1] || '';

        // Extract file:line references from output
        const fileLineMatch = fullOutput.match(/(\w+\.go):(\d+):/);
        const fileName = fileLineMatch?.[1];
        const lineNumber = fileLineMatch?.[2] ? parseInt(fileLineMatch[2], 10) : undefined;

        // Extract stack trace from panic output (look for goroutine patterns)
        let stack: string | undefined;
        // Match from "goroutine" to end or next "goroutine" or test marker
        const goroutineMatch = fullOutput.match(
          /goroutine \d+[\s\S]*?(?=(?:\ngoroutine|\n---|\n===|\z))/
        );
        if (goroutineMatch) {
          stack = goroutineMatch[0].trim();
        }

        // Store all output lines for this test
        // Ensure rawOutput has at least one element for schema validation
        const rawOutput =
          outputs.length > 0 ? outputs.map((line) => line.trimEnd()) : [`Test failed: ${testName}`];

        const validatedError = safeValidateExtractedError(
          {
            testName,
            fileName,
            lineNumber,
            message: fullOutput.trim() || `Test failed: ${testName}`,
            stack,
            duration: testDurations.get(key),
            rawOutput,
          },
          `test ${testName}`,
          validationTracker
        );

        failures.push(validatedError);
      }
    }

    // Generate summary
    const failed = Array.from(testResults.values()).filter((r) => r === 'fail').length;
    const passed = Array.from(testResults.values()).filter((r) => r === 'pass').length;
    const summary = failed > 0 ? `${failed} failed, ${passed} passed` : undefined;

    // Build parse warnings from test event parsing errors and validation errors
    const warnings: string[] = [];
    if (testEventParseErrors > 0) {
      let warning = `${testEventParseErrors} test event(s) failed to parse`;

      if (parseErrorSamples.length > 0) {
        warning += '\n\nFirst ' + parseErrorSamples.length + ' error(s):';
        for (const sample of parseErrorSamples) {
          warning += `\n  Line ${sample.lineNumber}: ${sample.errorMessage}`;
          warning += `\n    Content: ${sample.lineSnippet}`;
        }
        warning += '\n\nCheck: (1) -json flag set, (2) no mixed output, (3) valid UTF-8';
      }
      warnings.push(warning);
    }
    const validationWarning = validationTracker.getSummaryWarning();
    if (validationWarning) {
      warnings.push(validationWarning);
    }
    const parseWarnings = warnings.length > 0 ? warnings.join('; ') : undefined;

    return {
      framework: 'go',
      errors: failures,
      summary,
      parseWarnings,
    };
  }

  private parseGoTestText(logText: string, maxErrors: number): ExtractionResult {
    const lines = logText.split('\n');
    const failures: ExtractedError[] = [];
    let passed = 0;
    let failed = 0;
    const validationTracker = new ValidationErrorTracker();

    // Pattern: --- FAIL: TestName (0.01s)
    const failPattern = /^---\s*FAIL:\s+(\w+)\s+\((\d+(?:\.\d+)?)s\)/;
    const passPattern = /^---\s*PASS:\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = this.stripTimestamp(lines[i]);
      const passMatch = line.match(passPattern);
      if (passMatch) {
        passed++;
        continue;
      }

      const failMatch = line.match(failPattern);
      if (failMatch && failures.length < maxErrors) {
        const testName = failMatch[1];
        const duration = parseFloat(failMatch[2]) * 1000;

        // Collect output lines until next test or end
        const rawOutput: string[] = [];
        let fileName: string | undefined;
        let lineNumber: number | undefined;

        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = this.stripTimestamp(lines[j]);
          if (/^(---|===)/.test(nextLine)) break;
          rawOutput.push(nextLine);

          // Extract file:line from output
          const fileMatch = nextLine.match(/^\s+(\w+\.go):(\d+):/);
          if (fileMatch && !fileName) {
            fileName = fileMatch[1];
            lineNumber = parseInt(fileMatch[2], 10);
          }
        }

        // Ensure rawOutput has at least one element for schema validation
        if (rawOutput.length === 0) {
          rawOutput.push(`Test failed: ${testName}`);
        }

        const validatedError = safeValidateExtractedError(
          {
            testName,
            fileName,
            lineNumber,
            message: rawOutput.join('\n').trim() || `Test failed: ${testName}`,
            duration,
            rawOutput,
          },
          `test ${testName}`,
          validationTracker
        );

        failures.push(validatedError);
        failed++;
      }
    }

    const parseWarnings = validationTracker.getSummaryWarning();

    return {
      framework: 'go',
      errors: failures,
      summary: failed > 0 ? `${failed} failed, ${passed} passed` : undefined,
      parseWarnings,
    };
  }
}
