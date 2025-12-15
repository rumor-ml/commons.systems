/**
 * test_run tool - Execute tests for modules
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult, ValidationError, TestOutputParseError } from '../utils/errors.js';
import { DEFAULT_TEST_TIMEOUT, MAX_TEST_TIMEOUT } from '../constants.js';
import path from 'path';

export interface TestRunArgs {
  module?: string[];
  type?: 'unit' | 'e2e' | 'deployed-e2e';
  file?: string;
  filter?: string;
  changed_only?: boolean;
  verbose?: boolean;
  timeout_seconds?: number;
}

interface TestResult {
  module: string;
  test_type: string;
  status: string;
  output: string;
}

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

interface TestRunOutput {
  results: TestResult[];
  summary: TestSummary;
  exit_code: number;
}

/**
 * Parse JSON output from test script
 */
function parseTestOutput(stdout: string): TestRunOutput {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const parseError = error instanceof Error ? error : new Error(String(error));
    console.error('Failed to parse test output as JSON:', parseError.message);
    console.error('Raw output (first 500 chars):', stdout.substring(0, 500));

    // Throw instead of returning default - forces explicit error handling
    throw new TestOutputParseError(
      'Test script returned non-JSON output. This indicates a script error or unexpected output format.',
      stdout,
      parseError
    );
  }
}

/**
 * Format test results for display
 */
function formatTestResults(output: TestRunOutput): string {
  const lines: string[] = [];

  // Summary
  lines.push('Test Results Summary:');
  lines.push(`  Total: ${output.summary.total}`);
  lines.push(`  Passed: ${output.summary.passed}`);
  lines.push(`  Failed: ${output.summary.failed}`);
  lines.push(`  Skipped: ${output.summary.skipped}`);
  lines.push('');

  // Failed tests details
  const failedTests = output.results.filter((r) => r.status === 'failed');
  if (failedTests.length > 0) {
    lines.push('Failed Tests:');
    failedTests.forEach((test) => {
      lines.push(`  - ${test.module} (${test.test_type})`);
      if (test.output) {
        // Truncate long output
        const outputLines = test.output.split('\n').slice(0, 20);
        outputLines.forEach((line) => lines.push(`    ${line}`));
        if (test.output.split('\n').length > 20) {
          lines.push('    ... (output truncated)');
        }
      }
    });
    lines.push('');
  }

  // Passed tests (brief)
  const passedTests = output.results.filter((r) => r.status === 'passed');
  if (passedTests.length > 0) {
    lines.push('Passed Tests:');
    passedTests.forEach((test) => {
      lines.push(`  ✓ ${test.module} (${test.test_type})`);
    });
  }

  return lines.join('\n');
}

/**
 * Execute the test_run tool
 */
export async function testRun(args: TestRunArgs): Promise<ToolResult> {
  try {
    // Validate arguments
    const timeout = args.timeout_seconds || DEFAULT_TEST_TIMEOUT;
    if (timeout > MAX_TEST_TIMEOUT) {
      throw new ValidationError(`Timeout ${timeout}s exceeds maximum ${MAX_TEST_TIMEOUT}s`);
    }

    if (args.type && !['unit', 'e2e', 'deployed-e2e'].includes(args.type)) {
      throw new ValidationError(
        `Invalid test type: ${args.type}. Must be one of: unit, e2e, deployed-e2e`
      );
    }

    // Build script arguments
    const scriptArgs: string[] = ['--ci']; // Always use CI mode for JSON output

    if (args.module && args.module.length > 0) {
      // Ensure module is an array (MCP might pass it as a single value)
      const modules = Array.isArray(args.module) ? args.module : [args.module];
      scriptArgs.push(`--module=${modules.join(',')}`);
    }

    if (args.type) {
      scriptArgs.push(`--type=${args.type}`);
    }

    if (args.file) {
      scriptArgs.push(`--file=${args.file}`);
    }

    if (args.filter) {
      scriptArgs.push(`--filter=${args.filter}`);
    }

    if (args.changed_only) {
      scriptArgs.push('--changed-only');
    }

    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(root, 'infrastructure', 'scripts', 'test.sh');

    // Execute the test script
    const result = await execScript(scriptPath, scriptArgs, {
      timeout: timeout * 1000, // Convert to milliseconds
      cwd: root,
    });

    // Parse the JSON output
    const testOutput = parseTestOutput(result.stdout);

    // Format results
    const formattedOutput = formatTestResults(testOutput);

    return {
      content: [
        {
          type: 'text',
          text: formattedOutput,
        },
      ],
      _meta: {
        exit_code: testOutput.exit_code,
        summary: testOutput.summary,
        results: testOutput.results,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
