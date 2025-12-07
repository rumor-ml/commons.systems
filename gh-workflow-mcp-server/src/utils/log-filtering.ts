/**
 * Utilities for filtering and extracting specific sections from GitHub Actions logs
 */

/**
 * Extract logs for a specific step from full job logs.
 * GitHub Actions logs have this format:
 * JobName\tStepName\t2025-12-07T21:12:01.9189484Z Log line content
 *
 * @param fullLogs - Complete job logs from GitHub API
 * @param stepName - Name of the step to extract logs for
 * @param contextLines - Number of lines before/after to include for context (default: 0)
 * @returns Filtered logs containing only the specified step
 */
export function extractStepLogs(fullLogs: string, stepName: string, contextLines = 0): string {
  const lines = fullLogs.split('\n');
  const stepLines: string[] = [];
  let inStep = false;
  let currentStepName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse log line format: JobName\tStepName\tTimestamp Log content
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const logStepName = parts[1];

      // Check if we're entering our target step
      if (logStepName === stepName) {
        inStep = true;
        currentStepName = stepName;

        // Add context lines before if requested
        if (contextLines > 0 && stepLines.length === 0) {
          const startIdx = Math.max(0, i - contextLines);
          for (let j = startIdx; j < i; j++) {
            stepLines.push(lines[j]);
          }
        }
      }
      // Check if we've left our target step
      else if (inStep && logStepName !== currentStepName) {
        // Add context lines after if requested
        if (contextLines > 0) {
          const endIdx = Math.min(lines.length, i + contextLines);
          for (let j = i; j < endIdx; j++) {
            stepLines.push(lines[j]);
          }
        }
        break; // Stop collecting once we leave the step
      }
    }

    // Collect lines while in the target step
    if (inStep) {
      stepLines.push(line);
    }
  }

  return stepLines.join('\n');
}

/**
 * Extract the log content without the GitHub Actions metadata (job name, step name, timestamp)
 * Converts: "JobName\tStepName\t2025-12-07T21:12:01Z Content"
 * To: "Content"
 *
 * @param logs - Raw GitHub Actions logs
 * @returns Clean log content without metadata
 */
export function stripLogMetadata(logs: string): string {
  return logs
    .split('\n')
    .map((line) => {
      // Split on tabs - format is: JobName\tStepName\tTimestamp+Content
      const parts = line.split('\t');
      if (parts.length >= 3) {
        // Join everything after the second tab (timestamp + content)
        const timestampAndContent = parts.slice(2).join('\t');

        // Remove timestamp prefix (e.g., "2025-12-07T21:12:01.9189484Z ")
        // Timestamps are in ISO format followed by space or special chars
        const contentMatch = timestampAndContent.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*(.*)$/);
        if (contentMatch) {
          return contentMatch[1];
        }

        // If no timestamp found, return the whole thing (might be continuation line)
        return timestampAndContent;
      }

      // Line doesn't match expected format, return as-is
      return line;
    })
    .join('\n');
}

/**
 * Detect if logs indicate a timeout condition.
 * Common timeout patterns:
 * - Playwright outputs config JSON then terminates
 * - "Timeout of X exceeded" messages
 * - Process killed by timeout
 *
 * @param logs - Log content to analyze
 * @returns Object indicating if timeout detected and description
 */
export function detectTimeout(logs: string): {
  isTimeout: boolean;
  description?: string;
} {
  const lines = logs.split('\n');

  // Pattern 1: Playwright config JSON output without test results
  // This happens when Playwright is killed during execution
  let hasConfigJson = false;
  let hasTestResults = false;

  for (const line of lines) {
    if (line.includes('"config": {') || line.includes('"configFile":')) {
      hasConfigJson = true;
    }
    if (
      line.includes('passed') ||
      line.includes('failed') ||
      line.includes('✓') ||
      line.includes('✘')
    ) {
      hasTestResults = true;
    }
  }

  if (hasConfigJson && !hasTestResults) {
    return {
      isTimeout: true,
      description:
        'Playwright was interrupted during execution (config JSON output with no test results). This typically indicates a webServer timeout or port binding failure.',
    };
  }

  // Pattern 2: Explicit timeout messages
  const timeoutPatterns = [
    /timeout.*exceeded/i,
    /timed out after/i,
    /operation timed out/i,
    /SIGTERM/,
    /killed by timeout/i,
  ];

  for (const pattern of timeoutPatterns) {
    for (const line of lines) {
      if (pattern.test(line)) {
        return {
          isTimeout: true,
          description: `Timeout detected: ${line.trim()}`,
        };
      }
    }
  }

  return { isTimeout: false };
}
