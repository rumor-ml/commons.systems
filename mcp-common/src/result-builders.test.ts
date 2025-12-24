import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createErrorResult,
  createSuccessResult,
  createErrorResultFromError,
} from './result-builders.js';
import {
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  McpError,
  ParsingError,
  FormattingError,
} from './errors.js';

describe('createErrorResult', () => {
  it('creates error result for TimeoutError', () => {
    const error = new TimeoutError('Operation timed out');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'Error: Operation timed out');
    assert.equal((result._meta as any).errorType, 'TimeoutError');
    assert.equal((result._meta as any).errorCode, 'TIMEOUT');
  });

  it('creates error result for ValidationError', () => {
    const error = new ValidationError('Invalid input');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).errorType, 'ValidationError');
    assert.equal((result._meta as any).errorCode, 'VALIDATION_ERROR');
  });

  it('creates error result for NetworkError', () => {
    const error = new NetworkError('Connection failed');
    const result = createErrorResult(error);

    assert.equal((result._meta as any).errorType, 'NetworkError');
    assert.equal((result._meta as any).errorCode, 'NETWORK_ERROR');
  });

  it('creates error result for GitHubCliError', () => {
    const error = new GitHubCliError('gh failed', 1, 'stderr output');
    const result = createErrorResult(error);

    assert.equal((result._meta as any).errorType, 'GitHubCliError');
    assert.equal((result._meta as any).errorCode, 'GH_CLI_ERROR');
  });

  it('preserves GitHubCliError metadata for debugging', () => {
    const error = new GitHubCliError('gh pr create failed', 128, 'permission denied', 'partial output');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    if (result.isError) {
      assert.equal(result._meta.errorType, 'GitHubCliError');
      assert.equal(result._meta.errorCode, 'GH_CLI_ERROR');
      // Verify debugging metadata is preserved
      assert.equal((result._meta as any).exitCode, 128);
      assert.equal((result._meta as any).stderr, 'permission denied');
      assert.equal((result._meta as any).stdout, 'partial output');
    }
  });

  it('preserves GitHubCliError metadata without stdout', () => {
    const error = new GitHubCliError('gh failed', 1, 'error output');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    if (result.isError) {
      assert.equal((result._meta as any).exitCode, 1);
      assert.equal((result._meta as any).stderr, 'error output');
      assert.ok(!('stdout' in result._meta)); // stdout should not be present
    }
  });

  it('creates error result for ParsingError', () => {
    const error = new ParsingError('Failed to parse API response');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).errorType, 'ParsingError');
    assert.equal((result._meta as any).errorCode, 'PARSING_ERROR');
  });

  it('creates error result for FormattingError', () => {
    const error = new FormattingError('Invalid response structure');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).errorType, 'FormattingError');
    assert.equal((result._meta as any).errorCode, 'FORMATTING_ERROR');
  });

  it('creates error result for generic McpError', () => {
    const error = new McpError('Generic error', 'PARSING_ERROR');
    const result = createErrorResult(error);

    assert.equal((result._meta as any).errorType, 'McpError');
    assert.equal((result._meta as any).errorCode, 'PARSING_ERROR');
  });

  it('handles generic Error instances', () => {
    const error = new Error('Generic error');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).errorType, 'UnknownError');
  });

  it('handles string errors', () => {
    const result = createErrorResult('String error');

    assert.equal(result.content[0].text, 'Error: String error');
  });
});

describe('createSuccessResult', () => {
  it('creates success result with text only', () => {
    const result = createSuccessResult('Success');

    assert.equal(result.isError, false);
    assert.deepEqual(result.content, [{ type: 'text', text: 'Success' }]);
  });

  it('creates success result with metadata', () => {
    const result = createSuccessResult('Success', { key: 'value' });

    assert.equal(result.isError, false);
    assert.equal((result._meta as any).key, 'value');
  });
});

describe('createErrorResultFromError', () => {
  it('returns ToolError for TimeoutError', () => {
    const error = new TimeoutError('Timeout');
    const result = createErrorResultFromError(error);

    assert.notEqual(result, null);
    assert.equal(result!._meta.errorType, 'TimeoutError');
    assert.equal(result!._meta.errorCode, 'TIMEOUT');
  });

  it('returns ToolError for GitHubCliError', () => {
    const error = new GitHubCliError('gh failed', 1, 'stderr');
    const result = createErrorResultFromError(error);

    assert.notEqual(result, null);
    assert.equal(result!._meta.errorType, 'GitHubCliError');
    assert.equal(result!._meta.errorCode, 'GH_CLI_ERROR');
  });

  it('returns ToolError for ParsingError', () => {
    const error = new ParsingError('JSON parse failed');
    const result = createErrorResultFromError(error);

    assert.notEqual(result, null);
    assert.equal(result!._meta.errorType, 'ParsingError');
    assert.equal(result!._meta.errorCode, 'PARSING_ERROR');
  });

  it('returns ToolError for FormattingError', () => {
    const error = new FormattingError('Schema violation');
    const result = createErrorResultFromError(error);

    assert.notEqual(result, null);
    assert.equal(result!._meta.errorType, 'FormattingError');
    assert.equal(result!._meta.errorCode, 'FORMATTING_ERROR');
  });

  it('returns ToolError for generic McpError', () => {
    const error = new McpError('Error', 'PARSING_ERROR');
    const result = createErrorResultFromError(error);

    assert.notEqual(result, null);
    assert.equal(result!._meta.errorCode, 'PARSING_ERROR');
  });

  it('returns null for non-McpError without fallback (new default)', () => {
    const error = new Error('Generic');
    const result = createErrorResultFromError(error);

    // With fallbackToGeneric=false (new default), returns null
    assert.equal(result, null);
  });

  it('returns generic ToolError for non-McpError with fallback=true', () => {
    const error = new Error('Generic');
    const result = createErrorResultFromError(error, true);

    // With fallbackToGeneric=true, returns ToolError
    assert.notEqual(result, null);
    assert.equal(result!._meta.errorType, 'Error');
    assert.equal(result!._meta.errorCode, 'UNKNOWN_ERROR');
  });

  it('throws ValidationError in development mode for non-McpError without fallback', () => {
    const originalEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'development';

      const error = new Error('Generic error');

      assert.throws(
        () => createErrorResultFromError(error, false),
        (err: any) => {
          return (
            err instanceof ValidationError &&
            err.message.includes('Non-McpError passed to createErrorResultFromError') &&
            err.message.includes('Use createErrorResult() for automatic handling')
          );
        }
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('logs warning in production mode for non-McpError without fallback', () => {
    const originalEnv = process.env.NODE_ENV;
    const warnings: any[] = [];
    const originalWarn = console.warn;

    try {
      process.env.NODE_ENV = 'production';
      console.warn = (...args: any[]) => warnings.push(args);

      const error = new Error('Generic error');
      const result = createErrorResultFromError(error, false);

      // Verify it returns null
      assert.equal(result, null);

      // Verify console.warn was called
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0][0].includes('[mcp-common] Non-McpError passed to createErrorResultFromError'));
      assert.strictEqual(warnings[0][1], error);
    } finally {
      process.env.NODE_ENV = originalEnv;
      console.warn = originalWarn;
    }
  });

  it('logs warning in undefined NODE_ENV for non-McpError without fallback', () => {
    const originalEnv = process.env.NODE_ENV;
    const warnings: any[] = [];
    const originalWarn = console.warn;

    try {
      delete process.env.NODE_ENV;
      console.warn = (...args: any[]) => warnings.push(args);

      const error = new Error('Generic error');
      const result = createErrorResultFromError(error, false);

      // Verify it returns null
      assert.equal(result, null);

      // Verify console.warn was called
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0][0].includes('[mcp-common] Non-McpError passed to createErrorResultFromError'));
    } finally {
      process.env.NODE_ENV = originalEnv;
      console.warn = originalWarn;
    }
  });
});

describe('createErrorResult - system error handling', () => {
  it('re-throws system errors (ENOMEM)', () => {
    const systemError = { code: 'ENOMEM', message: 'Out of memory' };

    assert.throws(
      () => createErrorResult(systemError),
      (err: any) => err === systemError
    );
  });

  it('re-throws system errors (ENOSPC)', () => {
    const systemError = { code: 'ENOSPC', message: 'No space left' };

    assert.throws(
      () => createErrorResult(systemError),
      (err: any) => err === systemError
    );
  });

  it('detects and logs programming errors (TypeError)', () => {
    const error = new TypeError('Type error');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).isProgrammingError, true);
  });

  it('detects and logs programming errors (ReferenceError)', () => {
    const error = new ReferenceError('Reference error');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).isProgrammingError, true);
  });

  it('detects and logs programming errors (SyntaxError)', () => {
    const error = new SyntaxError('Syntax error');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).isProgrammingError, true);
  });

  it('does not mark other Error types as programming errors', () => {
    const error = new Error('Generic error');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.ok(!('isProgrammingError' in result._meta));
  });

  it('re-throws system errors without modification', () => {
    const systemError = Object.freeze({ code: 'ENOMEM', message: 'Out of memory' });

    try {
      createErrorResult(systemError);
      assert.fail('Should have thrown');
    } catch (error) {
      // Verify error is EXACTLY the same object (reference equality)
      assert.strictEqual(error, systemError);
      // Verify no new properties were added
      assert.deepEqual(Object.keys(error), ['code', 'message']);
    }
  });

  it('wraps ENOENT errors instead of re-throwing', () => {
    const fileError = { code: 'ENOENT', message: 'File not found' };

    // Should NOT throw, should wrap
    const result = createErrorResult(fileError);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).errorType, 'UnknownError');
  });

  it('wraps custom error codes instead of re-throwing', () => {
    const customError = { code: 'CUSTOM_ERROR', message: 'Custom failure' };

    const result = createErrorResult(customError);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).errorType, 'UnknownError');
  });
});

describe('createErrorResult - unknown error logging', () => {
  it('logs unknown Error instances with stack trace in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    const errors: any[] = [];
    const originalError = console.error;

    try {
      process.env.NODE_ENV = 'development';
      console.error = (...args: any[]) => errors.push(args);

      const error = new Error('Unknown error type');
      createErrorResult(error);

      // Verify console.error was called with stack trace
      assert.ok(errors.length >= 1);
      const unknownErrorLog = errors.find((e) =>
        e[0].includes('[mcp-common] Unknown error type converted to ToolError')
      );
      assert.ok(unknownErrorLog, 'Should log unknown error type');
      assert.ok(unknownErrorLog[1].stack !== undefined, 'Should include stack in development');
    } finally {
      process.env.NODE_ENV = originalEnv;
      console.error = originalError;
    }
  });

  it('logs unknown Error instances without stack trace in production', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDebug = process.env.DEBUG;
    const errors: any[] = [];
    const originalError = console.error;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DEBUG;
      console.error = (...args: any[]) => errors.push(args);

      const error = new Error('Unknown error type');
      createErrorResult(error);

      // Verify console.error was called without stack trace
      assert.ok(errors.length >= 1);
      const unknownErrorLog = errors.find((e) =>
        e[0].includes('[mcp-common] Unknown error type converted to ToolError')
      );
      assert.ok(unknownErrorLog, 'Should log unknown error type');
      assert.ok(unknownErrorLog[1].stack === undefined, 'Should not include stack in production');
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.DEBUG = originalDebug;
      console.error = originalError;
    }
  });
});

describe('createErrorResult - message truncation', () => {
  it('truncates long error messages to 200 characters including unicode', () => {
    // Create a message longer than 200 chars with unicode emoji
    const longMessage = '🚨 ' + 'A'.repeat(300) + ' 🚨';
    const error = new Error(longMessage);

    const errors: any[] = [];
    const originalError = console.error;
    console.error = (...args: any[]) => errors.push(args);

    try {
      createErrorResult(error);

      // Find the unknown error log entry
      const unknownErrorLog = errors.find((e) =>
        e[0].includes('[mcp-common] Unknown error type converted to ToolError')
      );
      assert.ok(unknownErrorLog, 'Should log unknown error type');
      // Verify message was truncated in log
      assert.ok(unknownErrorLog[1].message.length <= 200);
      assert.ok(unknownErrorLog[1].message.includes('🚨'));
    } finally {
      console.error = originalError;
    }
  });
});

describe('createErrorResult - GitHubCliError stdout edge cases', () => {
  it('handles empty string stdout', () => {
    const error = new GitHubCliError('Command failed', 1, 'stderr output', '');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    // Empty string stdout should not be included
    assert.ok(!('stdout' in result._meta));
  });

  it('handles whitespace-only stdout', () => {
    const error = new GitHubCliError('Command failed', 1, 'stderr output', '   \n\t  ');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    // Whitespace-only stdout should still be included (might be significant)
    assert.equal((result._meta as any).stdout, '   \n\t  ');
  });

  it('handles undefined stdout', () => {
    const error = new GitHubCliError('Command failed', 1, 'stderr output');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    // undefined stdout should not be included
    assert.ok(!('stdout' in result._meta));
  });
});
