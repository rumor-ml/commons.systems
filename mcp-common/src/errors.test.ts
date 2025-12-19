/**
 * Tests for MCP error classes and utility functions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  isTerminalError,
  formatError,
  isSystemError,
  SYSTEM_ERROR_CODES,
} from './errors.js';

describe('McpError', () => {
  it('creates error with message only', () => {
    const error = new McpError('Test error');

    assert.equal(error.message, 'Test error');
    assert.equal(error.name, 'McpError');
    assert.equal(error.code, undefined);
  });

  it('stores optional error code', () => {
    const errorWithCode = new McpError('Test error', 'PARSING_ERROR');

    assert.equal(errorWithCode.message, 'Test error');
    assert.equal(errorWithCode.code, 'PARSING_ERROR');
    assert.equal(errorWithCode.name, 'McpError');
  });

  it('code property is readonly', () => {
    const error = new McpError('Test', 'TIMEOUT');

    // TypeScript enforces readonly, but verify the property exists
    assert.equal(error.code, 'TIMEOUT');
  });

  it('extends Error properly', () => {
    const error = new McpError('Test error');

    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
    assert.ok(error.stack);
  });
});

describe('TimeoutError', () => {
  it('creates timeout error with correct code', () => {
    const error = new TimeoutError('Operation timed out');

    assert.equal(error.message, 'Operation timed out');
    assert.equal(error.name, 'TimeoutError');
    assert.equal(error.code, 'TIMEOUT');
  });

  it('extends McpError', () => {
    const error = new TimeoutError('Test');

    assert.ok(error instanceof TimeoutError);
    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
  });
});

describe('ValidationError', () => {
  it('creates validation error with correct code', () => {
    const error = new ValidationError('Invalid input');

    assert.equal(error.message, 'Invalid input');
    assert.equal(error.name, 'ValidationError');
    assert.equal(error.code, 'VALIDATION_ERROR');
  });

  it('extends McpError', () => {
    const error = new ValidationError('Test');

    assert.ok(error instanceof ValidationError);
    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
  });
});

describe('NetworkError', () => {
  it('creates network error with correct code', () => {
    const error = new NetworkError('Connection failed');

    assert.equal(error.message, 'Connection failed');
    assert.equal(error.name, 'NetworkError');
    assert.equal(error.code, 'NETWORK_ERROR');
  });

  it('extends McpError', () => {
    const error = new NetworkError('Test');

    assert.ok(error instanceof NetworkError);
    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
  });
});

describe('GitHubCliError', () => {
  it('creates error with valid exit code', () => {
    const error = new GitHubCliError('Command failed', 1, 'error output', 'success output');

    assert.equal(error.message, 'Command failed');
    assert.equal(error.name, 'GitHubCliError');
    assert.equal(error.code, 'GH_CLI_ERROR');
    assert.equal(error.exitCode, 1);
    assert.equal(error.stderr, 'error output');
    assert.equal(error.stdout, 'success output');
  });

  it('works without stdout (optional parameter)', () => {
    const error = new GitHubCliError('Command failed', 128, 'error only');

    assert.equal(error.stderr, 'error only');
    assert.equal(error.stdout, undefined);
  });

  it('clamps negative exit codes to 0', () => {
    const error = new GitHubCliError('Test', -5, 'stderr');

    assert.equal(error.exitCode, 0);
    assert.ok(error.message.includes('Warning: Invalid exit code -5'));
    assert.ok(error.message.includes('clamped to 0'));
  });

  it('clamps exit codes above 255 to 255', () => {
    const error = new GitHubCliError('Test', 500, 'stderr');

    assert.equal(error.exitCode, 255);
    assert.ok(error.message.includes('Warning: Invalid exit code 500'));
    assert.ok(error.message.includes('clamped to 255'));
  });

  it('does not modify message for valid exit codes', () => {
    const error = new GitHubCliError('Normal error', 1, 'stderr');

    assert.equal(error.message, 'Normal error');
    assert.ok(!error.message.includes('Warning'));
  });

  it('extends McpError', () => {
    const error = new GitHubCliError('Test', 1, 'stderr');

    assert.ok(error instanceof GitHubCliError);
    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
  });
});

describe('Error class inheritance chain', () => {
  it('TimeoutError maintains proper inheritance', () => {
    const error = new TimeoutError('Test');

    assert.ok(error instanceof TimeoutError);
    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
  });

  it('ValidationError maintains proper inheritance', () => {
    const error = new ValidationError('Test');

    assert.ok(error instanceof ValidationError);
    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
  });

  it('NetworkError maintains proper inheritance', () => {
    const error = new NetworkError('Test');

    assert.ok(error instanceof NetworkError);
    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
  });

  it('GitHubCliError maintains proper inheritance', () => {
    const error = new GitHubCliError('Test', 1, 'stderr');

    assert.ok(error instanceof GitHubCliError);
    assert.ok(error instanceof McpError);
    assert.ok(error instanceof Error);
  });
});

describe('Error name property', () => {
  it('McpError has correct name', () => {
    const error = new McpError('Test');
    assert.equal(error.name, 'McpError');
  });

  it('TimeoutError has correct name', () => {
    const error = new TimeoutError('Test');
    assert.equal(error.name, 'TimeoutError');
  });

  it('ValidationError has correct name', () => {
    const error = new ValidationError('Test');
    assert.equal(error.name, 'ValidationError');
  });

  it('NetworkError has correct name', () => {
    const error = new NetworkError('Test');
    assert.equal(error.name, 'NetworkError');
  });

  it('GitHubCliError has correct name', () => {
    const error = new GitHubCliError('Test', 1, 'stderr');
    assert.equal(error.name, 'GitHubCliError');
  });
});

describe('isTerminalError', () => {
  it('returns true for ValidationError', () => {
    const error = new ValidationError('Invalid input');
    assert.equal(isTerminalError(error), true);
  });

  it('returns false for TimeoutError', () => {
    const error = new TimeoutError('Timed out');
    assert.equal(isTerminalError(error), false);
  });

  it('returns false for NetworkError', () => {
    const error = new NetworkError('Connection failed');
    assert.equal(isTerminalError(error), false);
  });

  it('returns false for GitHubCliError', () => {
    const error = new GitHubCliError('gh failed', 1, 'stderr');
    assert.equal(isTerminalError(error), false);
  });

  it('returns false for McpError', () => {
    const error = new McpError('Generic error');
    assert.equal(isTerminalError(error), false);
  });

  it('returns false for generic Error instances', () => {
    const error = new Error('Standard error');
    assert.equal(isTerminalError(error), false);
  });

  it('returns false for TypeError', () => {
    const error = new TypeError('Type error');
    assert.equal(isTerminalError(error), false);
  });

  it('returns false for string errors', () => {
    assert.equal(isTerminalError('string error'), false);
  });

  it('returns false for null', () => {
    assert.equal(isTerminalError(null), false);
  });

  it('returns false for undefined', () => {
    assert.equal(isTerminalError(undefined), false);
  });

  it('returns false for non-Error objects', () => {
    assert.equal(isTerminalError({ message: 'not an error' }), false);
  });
});

describe('formatError', () => {
  it('formats McpError with code', () => {
    const error = new McpError('Test error', 'TIMEOUT');
    const formatted = formatError(error);

    assert.ok(formatted.includes('[McpError]'));
    assert.ok(formatted.includes('(TIMEOUT)'));
    assert.ok(formatted.includes('Test error'));
  });

  it('formats McpError without code', () => {
    const error = new McpError('Test error');
    const formatted = formatError(error);

    assert.ok(formatted.includes('[McpError]'));
    assert.ok(!formatted.includes('undefined'));
    assert.ok(formatted.includes('Test error'));
  });

  it('formats TimeoutError', () => {
    const error = new TimeoutError('Operation timed out');
    const formatted = formatError(error);

    assert.ok(formatted.includes('[TimeoutError]'));
    assert.ok(formatted.includes('(TIMEOUT)'));
    assert.ok(formatted.includes('Operation timed out'));
  });

  it('formats ValidationError', () => {
    const error = new ValidationError('Invalid input');
    const formatted = formatError(error);

    assert.ok(formatted.includes('[ValidationError]'));
    assert.ok(formatted.includes('(VALIDATION_ERROR)'));
    assert.ok(formatted.includes('Invalid input'));
  });

  it('formats standard Error instances', () => {
    const error = new Error('Standard error');
    const formatted = formatError(error);

    assert.equal(formatted, '[Error] Standard error');
  });

  it('formats TypeError', () => {
    const error = new TypeError('Type error');
    const formatted = formatError(error);

    assert.equal(formatted, '[TypeError] Type error');
  });

  it('formats string errors', () => {
    const formatted = formatError('string error');
    assert.equal(formatted, 'string error');
  });

  it('formats number errors', () => {
    const formatted = formatError(42);
    assert.equal(formatted, '42');
  });

  it('formats null', () => {
    const formatted = formatError(null);
    assert.equal(formatted, 'null');
  });

  it('formats undefined', () => {
    const formatted = formatError(undefined);
    assert.equal(formatted, 'undefined');
  });

  it('formats object errors', () => {
    const formatted = formatError({ message: 'object error' });
    assert.ok(formatted.includes('object'));
  });

  it('includes stack trace when requested', () => {
    const error = new Error('Test error');
    const formatted = formatError(error, true);

    assert.ok(formatted.includes('[Error] Test error'));
    assert.ok(formatted.includes('Stack:'));
    assert.ok(formatted.includes('at '));
  });

  it('excludes stack trace by default', () => {
    const error = new Error('Test error');
    const formatted = formatError(error, false);

    assert.equal(formatted, '[Error] Test error');
    assert.ok(!formatted.includes('Stack:'));
  });

  it('includes stack trace for McpError when requested', () => {
    const error = new McpError('Test', 'TIMEOUT');
    const formatted = formatError(error, true);

    assert.ok(formatted.includes('[McpError]'));
    assert.ok(formatted.includes('Stack:'));
  });
});

describe('isSystemError', () => {
  it('returns true for ENOMEM error code', () => {
    const error = { code: 'ENOMEM', message: 'Out of memory' };
    assert.equal(isSystemError(error), true);
  });

  it('returns true for ENOSPC error code', () => {
    const error = { code: 'ENOSPC', message: 'No space left' };
    assert.equal(isSystemError(error), true);
  });

  it('returns true for EMFILE error code', () => {
    const error = { code: 'EMFILE', message: 'Too many open files' };
    assert.equal(isSystemError(error), true);
  });

  it('returns true for ENFILE error code', () => {
    const error = { code: 'ENFILE', message: 'File table overflow' };
    assert.equal(isSystemError(error), true);
  });

  it('returns false for non-system error codes', () => {
    const error = { code: 'ENOENT', message: 'File not found' };
    assert.equal(isSystemError(error), false);
  });

  it('returns false for objects without code property', () => {
    const error = { message: 'Error' };
    assert.equal(isSystemError(error), false);
  });

  it('returns false for null', () => {
    assert.equal(isSystemError(null), false);
  });

  it('returns false for undefined', () => {
    assert.equal(isSystemError(undefined), false);
  });

  it('returns false for strings', () => {
    assert.equal(isSystemError('ENOMEM'), false);
  });

  it('returns false for errors with numeric code', () => {
    const error = { code: 123, message: 'Error' };
    assert.equal(isSystemError(error), false);
  });

  it('returns false for errors with symbol code', () => {
    const error = { code: Symbol('ENOMEM'), message: 'Error' };
    assert.equal(isSystemError(error), false);
  });

  it('returns false for errors with boolean code', () => {
    const error = { code: true, message: 'Error' };
    assert.equal(isSystemError(error), false);
  });

  it('verifies SYSTEM_ERROR_CODES constant', () => {
    assert.deepEqual(SYSTEM_ERROR_CODES, ['ENOMEM', 'ENOSPC', 'EMFILE', 'ENFILE']);
  });
});
