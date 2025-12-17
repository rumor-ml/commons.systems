/**
 * test_run tool - Execute tests for modules
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult, ValidationError, TestOutputParseError } from '../utils/errors.js';
import { TestRunArgsSchema, safeValidateArgs } from '../schemas.js';
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
 * Sanitize output to redact potential secrets
 */
function sanitizeOutput(output: string): string {
  // Match alphanumeric strings 40+ chars, then check if they look like base64
  // (contain + or / or end with =). Pure alphanumeric strings like file paths
  // and hashes are NOT redacted to avoid over-redaction.
  let sanitized = output.replace(/[A-Za-z0-9+/]{40,}={0,2}(?=[^A-Za-z0-9+/=]|$)/g, (match) => {
    // Check if it actually looks like base64 (has + or / or ends with =)
    if (match.includes('+') || match.includes('/') || match.endsWith('=')) {
      return '[REDACTED_BASE64]';
    }
    return match; // Don't redact pure alphanumeric strings
  });

  // Redact common API key patterns
  sanitized = sanitized.replace(/sk_[a-zA-Z0-9]{32,}/g, '[REDACTED_API_KEY]');
  sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]{36,}/g, '[REDACTED_GITHUB_TOKEN]');

  return sanitized;
}

/**
 * Parse JSON output from test script
 */
function parseTestOutput(stdout: string): { output?: TestRunOutput; error?: Error } {
  try {
    return { output: JSON.parse(stdout) };
  } catch (error) {
    const parseError = error instanceof Error ? error : new Error(String(error));
    const sanitized = sanitizeOutput(stdout);

    // Log first AND last portions to capture both start and end of output
    console.error(JSON.stringify({
      level: 'error',
      component: 'test-run',
      message: 'Failed to parse test output as JSON',
      error: {
        message: parseError.message,
        name: parseError.name,
      },
      context: {
        outputPreviewStart: sanitized.substring(0, 200),
        outputPreviewEnd: sanitized.substring(Math.max(0, sanitized.length - 200)),
        outputLength: sanitized.length,
      },
      timestamp: new Date().toISOString(),
    }));

    // Write full output to debug file (fire-and-forget)
    import('fs/promises')
      .then((fs) => {
        const debugFile = `/tmp/claude/test-output-parse-error-${Date.now()}.txt`;
        return fs.writeFile(debugFile, sanitized)
          .then(() => console.error(`Full output written to: ${debugFile}`));
      })
      .catch((error) => {
        // Log but don't throw - this is best-effort debug output
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Could not write debug output: ${errorMessage}`);
      });

    return {
      error: new TestOutputParseError(
        'Test script returned non-JSON output. This indicates a script error or unexpected output format.',
        stdout,
        parseError
      ),
    };
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
        const allLines = test.output.split('\n');
        const outputLines = allLines.slice(0, 20);
        outputLines.forEach((line) => lines.push(`    ${line}`));

        if (allLines.length > 20) {
          const omittedCount = allLines.length - 20;
          lines.push(`    ... (${omittedCount} more lines omitted, ${allLines.length} total)`);
          lines.push(`    Run with --verbose for full output`);
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
    // Validate arguments with Zod schema
    const validation = safeValidateArgs(TestRunArgsSchema, args);
    if (!validation.success) {
      throw new ValidationError(validation.error);
    }
    const validatedArgs = validation.data;

    // Validate test type if present (internal interface supports this)
    if (args.type && !['unit', 'e2e', 'deployed-e2e'].includes(args.type)) {
      throw new ValidationError(
        `Invalid test type: "${args.type}". Must be one of: "unit", "e2e", "deployed-e2e"`
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
      timeout: validatedArgs.timeout_seconds * 1000, // Convert to milliseconds
      cwd: root,
    });

    // Parse the JSON output
    const { output, error } = parseTestOutput(result.stdout);
    if (error) {
      return createErrorResult(error);
    }

    // Format results
    const formattedOutput = formatTestResults(output!);

    return {
      content: [
        {
          type: 'text',
          text: formattedOutput,
        },
      ],
      _meta: {
        exit_code: output!.exit_code,
        summary: output!.summary,
        results: output!.results,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
