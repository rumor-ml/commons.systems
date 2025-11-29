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
  Elapsed?: number;
}

export class GoExtractor implements FrameworkExtractor {
  readonly name = "go" as const;

  detect(logText: string): DetectionResult | null {
    const lines = logText.split("\n");
    let jsonLineCount = 0;
    let textMarkerCount = 0;

    // Sample first 100 lines for detection
    const sampleSize = Math.min(100, lines.length);

    for (let i = 0; i < sampleSize; i++) {
      const line = lines[i];

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

    for (const line of lines) {
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

        // Track test results
        if (event.Action === "fail" && event.Test) {
          testResults.set(key, "fail");
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

        // Extract context lines (indented lines with actual assertions)
        const contextLines = outputs
          .filter((line) => line.trim() && (line.startsWith("    ") || line.startsWith("\t")))
          .map((line) => line.trimEnd());

        failures.push({
          testName,
          fileName,
          lineNumber,
          message: fullOutput.trim() || `Test failed: ${testName}`,
          context: contextLines,
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
    const lines = logText.split("\n");
    const failures: ExtractedError[] = [];
    const failPattern = /^---\s*FAIL:\s*(\S+)/;
    const fileLinePattern = /(\w+\.go):(\d+):/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(failPattern);
      if (match) {
        const testName = match[1];
        const contextLines: string[] = [];
        let fileName: string | undefined;
        let lineNumber: number | undefined;

        // Collect indented assertion lines and context
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j];

          // Stop at next test marker or package result
          if (/^(---|===|FAIL\t|PASS\t)/.test(line)) {
            break;
          }

          // Collect indented lines (test output)
          if (line.startsWith("    ") || line.startsWith("\t")) {
            contextLines.push(line.trimEnd());

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

        // Build message from context lines
        const message = contextLines.length > 0
          ? contextLines.join("\n")
          : `Test failed: ${testName}`;

        failures.push({
          testName,
          fileName,
          lineNumber,
          message,
          context: contextLines,
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
