/**
 * Go test framework extractor - parses both JSON and text output
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from './types.js';

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

  extract(logText: string, maxErrors = 10): ExtractionResult {
    const detection = this.detect(logText);

    if (detection?.isJsonOutput) {
      return this.parseGoTestJson(logText);
    } else if (detection) {
      return this.parseGoTestText(logText, maxErrors);
    }

    // No Go tests detected
    return {
      framework: 'unknown',
      errors: [],
    };
  }

  private parseGoTestJson(logText: string): ExtractionResult {
    const lines = logText.split('\n');
    const testOutputs = new Map<string, string[]>();
    const failures: ExtractedError[] = [];
    const testResults = new Map<string, 'pass' | 'fail'>();
    const testDurations = new Map<string, number>();
    let skippedNonJsonLines = 0;

    for (const rawLine of lines) {
      const line = this.stripTimestamp(rawLine);
      if (!line.startsWith('{')) continue;

      try {
        const event = JSON.parse(line) as GoTestEvent;

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
      } catch (error) {
        // Skip invalid JSON lines - these are expected in normal test output:
        //   - Build/compilation messages before tests run
        //   - GitHub Actions runner setup logs
        //   - Package download/cache messages
        //   - Environment variable output
        //   - Test execution summary lines (e.g., "PASS", "FAIL" markers)
        // Only the actual test events are JSON formatted when using -json flag
        // Log only first few failures to avoid spam
        if (skippedNonJsonLines < 3) {
          console.error(
            `[INFO] Go extractor: failed to parse JSON line (failure ${skippedNonJsonLines + 1}): ${error instanceof Error ? error.message : String(error)}`
          );
        }
        skippedNonJsonLines++;
        continue;
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
        assessment = 'MODERATE - Significant number of non-JSON lines';
        severity = 'DEBUG';
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
        const rawOutput = outputs.map((line) => line.trimEnd());

        failures.push({
          testName,
          fileName,
          lineNumber,
          message: fullOutput.trim() || `Test failed: ${testName}`,
          stack,
          duration: testDurations.get(key),
          rawOutput,
        });
      }
    }

    // Generate summary
    const failed = Array.from(testResults.values()).filter((r) => r === 'fail').length;
    const passed = Array.from(testResults.values()).filter((r) => r === 'pass').length;
    const summary = failed > 0 ? `${failed} failed, ${passed} passed` : undefined;

    return {
      framework: 'go',
      errors: failures,
      summary,
    };
  }

  private parseGoTestText(logText: string, maxErrors: number): ExtractionResult {
    const lines = logText.split('\n');
    const failures: ExtractedError[] = [];
    let passed = 0;
    let failed = 0;

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

        failures.push({
          testName,
          fileName,
          lineNumber,
          message: rawOutput.join('\n').trim() || `Test failed: ${testName}`,
          duration,
          rawOutput,
        });
        failed++;
      }
    }

    return {
      framework: 'go',
      errors: failures,
      summary: failed > 0 ? `${failed} failed, ${passed} passed` : undefined,
    };
  }
}
