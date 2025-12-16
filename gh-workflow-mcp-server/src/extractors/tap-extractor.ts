/**
 * TAP (Test Anything Protocol) extractor for Node.js test output
 */

import type {
  DetectionResult,
  ExtractionResult,
  ExtractedError,
  FrameworkExtractor,
} from './types.js';
import { validateExtractedError } from './types.js';

export class TapExtractor implements FrameworkExtractor {
  readonly name = 'tap' as const;

  detect(logText: string): DetectionResult | null {
    const lines = logText.split('\n');
    let tapMarkerCount = 0;

    // Sample first 100 lines for detection
    const sampleSize = Math.min(100, lines.length);

    for (let i = 0; i < sampleSize; i++) {
      const line = lines[i];

      // Check for TAP-specific markers
      if (
        /^TAP version \d+/.test(line) ||
        /^(ok|not ok) \d+/.test(line) ||
        /^# Subtest:/.test(line) ||
        /^  ---$/.test(line)
      ) {
        tapMarkerCount++;
      }
    }

    // High confidence if we see multiple TAP markers
    if (tapMarkerCount >= 3) {
      return {
        framework: 'tap',
        confidence: 'high',
        isJsonOutput: false,
      };
    }

    // Medium confidence with at least one marker
    if (tapMarkerCount > 0) {
      return {
        framework: 'tap',
        confidence: 'medium',
        isJsonOutput: false,
      };
    }

    return null;
  }

  extract(logText: string, maxErrors = 10): ExtractionResult {
    const lines = logText.split('\n');
    const failures: ExtractedError[] = [];

    // TAP failure line format:
    // not ok N - test name
    // Followed by YAML diagnostic block:
    //   ---
    //   duration_ms: 123
    //   failureType: 'testCodeFailure'
    //   error: 'Error message'
    //   code: 'ERR_ASSERTION'
    //   stack: |
    //     Error: ...
    //     at file:line:col
    //   ...
    const failPattern = /^not ok \d+ - (.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(failPattern);
      if (match) {
        const testName = match[1].trim();
        const rawOutput: string[] = [lines[i]];
        let duration: number | undefined;
        let failureType: string | undefined;
        let errorMessage = 'Test failed';
        let errorCode: string | undefined;
        let stack: string | undefined;
        let fileName: string | undefined;
        let lineNumber: number | undefined;
        let columnNumber: number | undefined;

        // Look for YAML diagnostic block (starts with '  ---')
        let inYaml = false;
        let yamlLines: string[] = [];

        for (let j = i + 1; j < lines.length && j < i + 50; j++) {
          const line = lines[j];

          // Check if YAML block starts
          if (line === '  ---') {
            inYaml = true;
            rawOutput.push(line);
            continue;
          }

          // Check if YAML block ends
          if (line === '  ...') {
            inYaml = false;
            rawOutput.push(line);
            break;
          }

          // Stop at next test result
          if (!inYaml && /^(ok|not ok) \d+/.test(line)) {
            break;
          }

          if (inYaml) {
            yamlLines.push(line);
            rawOutput.push(line);
          }
        }

        // Parse YAML diagnostic block
        if (yamlLines.length > 0) {
          const yamlText = yamlLines.join('\n');

          // Extract duration_ms
          const durationMatch = yamlText.match(/duration_ms:\s*([0-9.]+)/);
          if (durationMatch) {
            duration = parseFloat(durationMatch[1]);
          }

          // Extract failureType
          const failureTypeMatch = yamlText.match(/failureType:\s*['"]?([^'"\n]+)['"]?/);
          if (failureTypeMatch) {
            failureType = failureTypeMatch[1];
          }

          // Extract error message
          const errorMatch = yamlText.match(/error:\s*['"](.+?)['"](?:\n|$)/);
          if (errorMatch) {
            errorMessage = errorMatch[1];
          }

          // Extract error code
          const codeMatch = yamlText.match(/code:\s*['"]?([^'"\n]+)['"]?/);
          if (codeMatch) {
            errorCode = codeMatch[1];
          }

          // Extract stack trace (can be multiline using | or >)
          const stackMatch = yamlText.match(/stack:\s*\|?\n((?:[ ]{4,}.+\n?)+)/);
          if (stackMatch) {
            stack = stackMatch[1].trim();

            // Extract file:line:column from stack trace
            const locationMatch = stack.match(/at .+ \((.+):(\d+):(\d+)\)/);
            if (locationMatch) {
              fileName = locationMatch[1].split('/').pop(); // Get just the filename
              lineNumber = parseInt(locationMatch[2], 10);
              columnNumber = parseInt(locationMatch[3], 10);
            } else {
              // Try alternative format: file:line:column
              const altLocationMatch = stack.match(/([^/\s]+\.(?:js|ts|mjs)):(\d+):(\d+)/);
              if (altLocationMatch) {
                fileName = altLocationMatch[1];
                lineNumber = parseInt(altLocationMatch[2], 10);
                columnNumber = parseInt(altLocationMatch[3], 10);
              }
            }
          }
        }

        try {
          const error = validateExtractedError({
            testName,
            fileName,
            lineNumber,
            columnNumber,
            message: errorMessage,
            stack,
            duration,
            failureType,
            errorCode,
            rawOutput,
          });
          failures.push(error);
        } catch (e) {
          // Log validation error but don't fail the entire extraction
          console.error(`[WARN] TAP extractor: Validation failed for extracted error: ${e}`);
          console.error(`[DEBUG] Test name: ${testName}, raw output lines: ${rawOutput.length}`);
        }

        if (failures.length >= maxErrors) break;
      }
    }

    // Try to extract summary
    let summary: string | undefined;
    const summaryPattern = /# fail (\d+)/;
    const totalPattern = /# tests (\d+)/;

    let failed: number | undefined;
    let total: number | undefined;

    // Search from end for summary
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
      if (!failed) {
        const failMatch = lines[i].match(summaryPattern);
        if (failMatch) failed = parseInt(failMatch[1], 10);
      }
      if (!total) {
        const totalMatch = lines[i].match(totalPattern);
        if (totalMatch) total = parseInt(totalMatch[1], 10);
      }
      if (failed !== undefined && total !== undefined) {
        const passed = total - failed;
        summary = `${failed} failed, ${passed} passed`;
        break;
      }
    }

    if (!summary && failed !== undefined) {
      summary = `${failed} failed`;
    }

    return {
      framework: 'tap',
      errors: failures,
      summary,
    };
  }
}
