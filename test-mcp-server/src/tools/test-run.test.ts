/**
 * Tests for test_run tool - input validation and formatting
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_TEST_TIMEOUT, MAX_TEST_TIMEOUT } from '../constants.js';

// Mock types for testing (avoiding actual execution)
interface TestRunArgs {
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
 * Validate test run arguments (extracted logic for testing)
 */
function validateTestRunArgs(args: TestRunArgs): string[] {
  const errors: string[] = [];

  // Validate timeout
  const timeout = args.timeout_seconds || DEFAULT_TEST_TIMEOUT;
  if (timeout > MAX_TEST_TIMEOUT) {
    errors.push(`Timeout ${timeout}s exceeds maximum ${MAX_TEST_TIMEOUT}s`);
  }
  if (timeout <= 0) {
    errors.push('Timeout must be positive');
  }

  // Validate test type
  if (args.type && !['unit', 'e2e', 'deployed-e2e'].includes(args.type)) {
    errors.push(
      `Invalid test type: ${args.type}. Must be one of: unit, e2e, deployed-e2e`
    );
  }

  // Validate module array
  if (args.module && !Array.isArray(args.module)) {
    errors.push('Module must be an array');
  }

  return errors;
}

/**
 * Build script arguments (extracted logic for testing)
 */
function buildScriptArgs(args: TestRunArgs): string[] {
  const scriptArgs: string[] = ['--ci']; // Always use CI mode

  if (args.module && args.module.length > 0) {
    scriptArgs.push(`--module=${args.module.join(',')}`);
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

  return scriptArgs;
}

/**
 * Parse test output (mock implementation for testing)
 */
function parseTestOutput(stdout: string): TestRunOutput {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    return {
      results: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      exit_code: 1,
    };
  }
}

/**
 * Format test results (mock implementation for testing)
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

describe('Test Run Input Validation', () => {
  it('should accept valid timeout within range', () => {
    const args: TestRunArgs = { timeout_seconds: 300 };
    const errors = validateTestRunArgs(args);
    assert.strictEqual(errors.length, 0);
  });

  it('should reject timeout exceeding maximum', () => {
    const args: TestRunArgs = { timeout_seconds: MAX_TEST_TIMEOUT + 100 };
    const errors = validateTestRunArgs(args);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('exceeds maximum'));
  });

  it('should use default timeout when not specified', () => {
    const args: TestRunArgs = {};
    const errors = validateTestRunArgs(args);
    assert.strictEqual(errors.length, 0);
  });

  it('should reject negative timeout', () => {
    const args: TestRunArgs = { timeout_seconds: -1 };
    const errors = validateTestRunArgs(args);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('positive'));
  });

  it('should accept valid test types', () => {
    const validTypes: Array<'unit' | 'e2e' | 'deployed-e2e'> = [
      'unit',
      'e2e',
      'deployed-e2e',
    ];

    validTypes.forEach((type) => {
      const args: TestRunArgs = { type };
      const errors = validateTestRunArgs(args);
      assert.strictEqual(errors.length, 0, `${type} should be valid`);
    });
  });

  it('should reject invalid test type', () => {
    const args = { type: 'invalid' as any } as TestRunArgs;
    const errors = validateTestRunArgs(args);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('Invalid test type'));
  });

  it('should accept module array', () => {
    const args: TestRunArgs = { module: ['printsync', 'fellspiral'] };
    const errors = validateTestRunArgs(args);
    assert.strictEqual(errors.length, 0);
  });

  it('should accept empty module array', () => {
    const args: TestRunArgs = { module: [] };
    const errors = validateTestRunArgs(args);
    assert.strictEqual(errors.length, 0);
  });
});

describe('Script Arguments Builder', () => {
  it('should always include --ci flag', () => {
    const args: TestRunArgs = {};
    const scriptArgs = buildScriptArgs(args);
    assert.ok(scriptArgs.includes('--ci'));
  });

  it('should build module filter argument', () => {
    const args: TestRunArgs = { module: ['printsync', 'fellspiral'] };
    const scriptArgs = buildScriptArgs(args);
    assert.ok(scriptArgs.includes('--module=printsync,fellspiral'));
  });

  it('should not include module filter for empty array', () => {
    const args: TestRunArgs = { module: [] };
    const scriptArgs = buildScriptArgs(args);
    const hasModuleArg = scriptArgs.some((arg) => arg.startsWith('--module='));
    assert.strictEqual(hasModuleArg, false);
  });

  it('should build type filter argument', () => {
    const args: TestRunArgs = { type: 'unit' };
    const scriptArgs = buildScriptArgs(args);
    assert.ok(scriptArgs.includes('--type=unit'));
  });

  it('should build file filter argument', () => {
    const args: TestRunArgs = { file: 'auth-flow' };
    const scriptArgs = buildScriptArgs(args);
    assert.ok(scriptArgs.includes('--file=auth-flow'));
  });

  it('should build filter argument', () => {
    const args: TestRunArgs = { filter: 'login flow' };
    const scriptArgs = buildScriptArgs(args);
    assert.ok(scriptArgs.includes('--filter=login flow'));
  });

  it('should include changed-only flag when true', () => {
    const args: TestRunArgs = { changed_only: true };
    const scriptArgs = buildScriptArgs(args);
    assert.ok(scriptArgs.includes('--changed-only'));
  });

  it('should not include changed-only flag when false', () => {
    const args: TestRunArgs = { changed_only: false };
    const scriptArgs = buildScriptArgs(args);
    assert.ok(!scriptArgs.includes('--changed-only'));
  });

  it('should build combined arguments', () => {
    const args: TestRunArgs = {
      module: ['printsync'],
      type: 'e2e',
      file: 'auth',
      filter: 'login',
      changed_only: true,
    };
    const scriptArgs = buildScriptArgs(args);

    assert.ok(scriptArgs.includes('--ci'));
    assert.ok(scriptArgs.includes('--module=printsync'));
    assert.ok(scriptArgs.includes('--type=e2e'));
    assert.ok(scriptArgs.includes('--file=auth'));
    assert.ok(scriptArgs.includes('--filter=login'));
    assert.ok(scriptArgs.includes('--changed-only'));
  });
});

describe('Test Output Parser', () => {
  it('should parse valid JSON output', () => {
    const jsonOutput = JSON.stringify({
      results: [
        {
          module: 'printsync',
          test_type: 'unit',
          status: 'passed',
          output: '',
        },
      ],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
      exit_code: 0,
    });

    const parsed = parseTestOutput(jsonOutput);
    assert.strictEqual(parsed.summary.total, 1);
    assert.strictEqual(parsed.summary.passed, 1);
    assert.strictEqual(parsed.exit_code, 0);
  });

  it('should handle invalid JSON gracefully', () => {
    const parsed = parseTestOutput('not valid json');
    assert.strictEqual(parsed.summary.total, 0);
    assert.strictEqual(parsed.exit_code, 1);
    assert.strictEqual(parsed.results.length, 0);
  });

  it('should handle empty string', () => {
    const parsed = parseTestOutput('');
    assert.strictEqual(parsed.summary.total, 0);
    assert.strictEqual(parsed.exit_code, 1);
  });
});

describe('Test Results Formatter', () => {
  it('should format summary correctly', () => {
    const output: TestRunOutput = {
      results: [],
      summary: { total: 10, passed: 7, failed: 2, skipped: 1 },
      exit_code: 1,
    };

    const formatted = formatTestResults(output);
    assert.ok(formatted.includes('Total: 10'));
    assert.ok(formatted.includes('Passed: 7'));
    assert.ok(formatted.includes('Failed: 2'));
    assert.ok(formatted.includes('Skipped: 1'));
  });

  it('should list passed tests', () => {
    const output: TestRunOutput = {
      results: [
        {
          module: 'printsync',
          test_type: 'unit',
          status: 'passed',
          output: '',
        },
      ],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
      exit_code: 0,
    };

    const formatted = formatTestResults(output);
    assert.ok(formatted.includes('Passed Tests:'));
    assert.ok(formatted.includes('✓ printsync (unit)'));
  });

  it('should list failed tests with details', () => {
    const output: TestRunOutput = {
      results: [
        {
          module: 'printsync',
          test_type: 'e2e',
          status: 'failed',
          output: 'Error: test failed',
        },
      ],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      exit_code: 1,
    };

    const formatted = formatTestResults(output);
    assert.ok(formatted.includes('Failed Tests:'));
    assert.ok(formatted.includes('- printsync (e2e)'));
    assert.ok(formatted.includes('Error: test failed'));
  });

  it('should truncate long output', () => {
    const longOutput = Array(30)
      .fill('line of output')
      .join('\n');

    const output: TestRunOutput = {
      results: [
        {
          module: 'test',
          test_type: 'unit',
          status: 'failed',
          output: longOutput,
        },
      ],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      exit_code: 1,
    };

    const formatted = formatTestResults(output);
    assert.ok(formatted.includes('... (output truncated)'));
  });

  it('should handle mixed passed and failed tests', () => {
    const output: TestRunOutput = {
      results: [
        {
          module: 'printsync',
          test_type: 'unit',
          status: 'passed',
          output: '',
        },
        {
          module: 'fellspiral',
          test_type: 'e2e',
          status: 'failed',
          output: 'Error',
        },
      ],
      summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
      exit_code: 1,
    };

    const formatted = formatTestResults(output);
    assert.ok(formatted.includes('Passed Tests:'));
    assert.ok(formatted.includes('Failed Tests:'));
    assert.ok(formatted.includes('✓ printsync (unit)'));
    assert.ok(formatted.includes('- fellspiral (e2e)'));
  });
});
