/**
 * Go test framework extractor - parses both JSON and text output
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from "./types.js";

interface GoTestEvent {
  Time: string;
  Action: "run" | "pass" | "fail" | "output" | "skip" | "pause" | "cont";
  Package: string;
  Test?: string;
  Output?: string;
  Elapsed?: number; // Test duration in seconds
}

export class GoExtractor implements FrameworkExtractor {
  readonly name = "go" as const;

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
    const lines = logText.split("\n");
    let jsonLineCount = 0;
    let textMarkerCount = 0;

    // Sample first 500 lines for detection - GitHub Actions logs have significant
    // preamble (runner setup, checkout, etc.) before actual test output begins
    const sampleSize = Math.min(500, lines.length);

    for (let i = 0; i < sampleSize; i++) {
      const line = this.stripTimestamp(lines[i]);

      // Check for Go test JSON format
      if (line.startsWith("{") && line.includes('"Time"') && line.includes('"Action"')) {
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
        framework: "go",
        confidence: "high",
        isJsonOutput: true,
      };
    }

    // High confidence for text format if we see multiple test markers
    if (textMarkerCount >= 2) {
      return {
        framework: "go",
        confidence: "high",
        isJsonOutput: false,
      };
    }

    // Medium confidence with at least one marker
    if (jsonLineCount > 0 || textMarkerCount > 0) {
      return {
        framework: "go",
        confidence: "medium",
        isJsonOutput: jsonLineCount > 0,
      };
    }

    return null;
  }

  extract(logText: string, maxErrors = 10): ExtractionResult {
    const detection = this.detect(logText);

    if (detection?.isJsonOutput) {
      return this.parseGoTestJson(logText, maxErrors);
    } else {
      return this.parseGoTestText(logText, maxErrors);
    }
  }

  private parseGoTestJson(logText: string, maxErrors: number): ExtractionResult {
    const lines = logText.split("\n");
    const testOutputs = new Map<string, string[]>();
    const failures: ExtractedError[] = [];
    const testResults = new Map<string, "pass" | "fail">();
    const testDurations = new Map<string, number>();

    for (const rawLine of lines) {
      const line = this.stripTimestamp(rawLine);
      if (!line.startsWith("{")) continue;

      try {
        const event = JSON.parse(line) as GoTestEvent;

        // Use a more specific key that includes both package and test
        // This ensures we don't mix up tests from different packages
        const key = event.Test
          ? `${event.Package}::${event.Test}`
          : event.Package;

        // Collect output lines for each test
        if (event.Action === "output" && event.Output) {
          if (!testOutputs.has(key)) {
            testOutputs.set(key, []);
          }
          testOutputs.get(key)!.push(event.Output);
        }

        // Track test results and duration
        if (event.Action === "fail" && event.Test) {
          testResults.set(key, "fail");
          if (event.Elapsed !== undefined) {
            testDurations.set(key, event.Elapsed * 1000); // Convert to ms
          }
        } else if (event.Action === "pass" && event.Test) {
          testResults.set(key, "pass");
        }
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }

    // Extract failures with their output
    for (const [key, result] of testResults.entries()) {
      if (result === "fail") {
        const outputs = testOutputs.get(key) || [];
        const fullOutput = outputs.join("");

        // Parse the test name from key (format: "package::testname")
        const parts = key.split("::");
        const testName = parts[1] || "";

        // Extract file:line references from output
        const fileLineMatch = fullOutput.match(/(\w+\.go):(\d+):/);
        const fileName = fileLineMatch?.[1];
        const lineNumber = fileLineMatch?.[2] ? parseInt(fileLineMatch[2], 10) : undefined;

        // Extract stack trace from panic output (look for goroutine patterns)
        let stack: string | undefined;
        // Match from "goroutine" to end or next "goroutine" or test marker
        const goroutineMatch = fullOutput.match(/goroutine \d+[\s\S]*?(?=(?:\ngoroutine|\n---|\n===|\z))/);
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

        if (failures.length >= maxErrors) break;
      }
    }

    // Generate summary
    const failed = Array.from(testResults.values()).filter((r) => r === "fail").length;
    const passed = Array.from(testResults.values()).filter((r) => r === "pass").length;
    const summary = failed > 0 ? `${failed} failed, ${passed} passed` : undefined;

    return {
      framework: "go",
      errors: failures,
      summary,
    };
  }

  private parseGoTestText(logText: string, maxErrors: number): ExtractionResult {
    const rawLines = logText.split("\n");
    const lines = rawLines.map((line) => this.stripTimestamp(line));
    const failures: ExtractedError[] = [];
    const failPattern = /^---\s*FAIL:\s*(\S+)\s*\(([0-9.]+)s\)?/;
    const fileLinePattern = /(\w+\.go):(\d+):/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(failPattern);
      if (match) {
        const testName = match[1];
        const duration = match[2] ? parseFloat(match[2]) * 1000 : undefined; // Convert to ms
        const rawOutput: string[] = [];
        let fileName: string | undefined;
        let lineNumber: number | undefined;
        let stack: string | undefined;

        // Collect indented assertion lines and context
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j];

          // Stop at next test marker or package result
          if (/^(---|===|FAIL\t|PASS\t)/.test(line)) {
            break;
          }

          // Collect indented lines (test output)
          if (line.startsWith("    ") || line.startsWith("\t")) {
            rawOutput.push(line.trimEnd());

            // Extract file:line reference if present
            if (!fileName) {
              const fileMatch = line.match(fileLinePattern);
              if (fileMatch) {
                fileName = fileMatch[1];
                lineNumber = parseInt(fileMatch[2], 10);
              }
            }
          }
        }

        // Extract stack trace from panic output (look for goroutine patterns)
        const fullOutput = rawOutput.join("\n");
        // Match from "goroutine" to end or next "goroutine" or test marker
        const goroutineMatch = fullOutput.match(/goroutine \d+[\s\S]*?(?=(?:\ngoroutine|\n---|\n===|\z))/);
        if (goroutineMatch) {
          stack = goroutineMatch[0].trim();
        }

        // Build message from raw output
        const message = rawOutput.length > 0
          ? rawOutput.join("\n")
          : `Test failed: ${testName}`;

        failures.push({
          testName,
          fileName,
          lineNumber,
          message,
          stack,
          duration,
          rawOutput,
        });

        if (failures.length >= maxErrors) break;
      }
    }

    // Try to extract summary from package results
    let summary: string | undefined;
    const summaryPattern = /(\d+)\s+failed.*(\d+)\s+passed/i;

    for (const line of lines) {
      const summaryMatch = line.match(summaryPattern);
      if (summaryMatch) {
        summary = `${summaryMatch[1]} failed, ${summaryMatch[2]} passed`;
        break;
      }
    }

    // If no summary, at least count failures
    if (!summary && failures.length > 0) {
      summary = `${failures.length} failed`;
    }

    return {
      framework: "go",
      errors: failures,
      summary,
    };
  }
}
