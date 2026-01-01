/**
 * Tests for MCP types and factory functions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createToolSuccess,
  createToolError,
  isToolError,
  isToolSuccess,
  validateToolResult,
  type ToolResult,
  type ToolResultStrict,
  type ToolSuccess,
  type ToolSuccessStrict,
  type ToolError,
  type ToolErrorStrict,
} from './types.js';
import { GitHubCliError, isSystemError } from './errors.js';

describe('createToolSuccess', () => {
  it('creates success result with text only', () => {
    const result = createToolSuccess('Operation completed');

    assert.deepEqual(result.content, [{ type: 'text', text: 'Operation completed' }]);
    assert.equal(result.isError, false);
    assert.equal(result._meta, undefined);
  });

  it('includes metadata when provided', () => {
    const result = createToolSuccess('User created', { userId: '123', role: 'admin' });

    assert.deepEqual(result.content, [{ type: 'text', text: 'User created' }]);
    assert.equal(result.isError, false);
    assert.deepEqual(result._meta, { userId: '123', role: 'admin' });
  });

  it('returns properly typed ToolSuccess', () => {
    const result: ToolSuccess = createToolSuccess('Test');

    // Type assertion - if this compiles, type is correct
    assert.equal(result.isError, false);
  });

  it('ToolSuccess is assignable to ToolSuccessStrict for application code', () => {
    // Factory returns ToolSuccess, which can be used where ToolSuccessStrict is expected
    // This enables strict type checking in application code
    const result: ToolSuccessStrict = createToolSuccess('Test');
    assert.equal(result.isError, false);
  });
});

describe('createToolError', () => {
  it('creates error result with required fields only', () => {
    const result = createToolError('File not found', 'NotFoundError');

    assert.deepEqual(result.content, [{ type: 'text', text: 'File not found' }]);
    assert.equal(result.isError, true);
    assert.equal(result._meta.errorType, 'NotFoundError');
    assert.equal(result._meta.errorCode, undefined);
  });

  it('includes errorCode when provided', () => {
    const result = createToolError('Invalid input', 'ValidationError', 'INVALID_EMAIL');

    assert.deepEqual(result.content, [{ type: 'text', text: 'Invalid input' }]);
    assert.equal(result.isError, true);
    assert.equal(result._meta.errorType, 'ValidationError');
    assert.equal(result._meta.errorCode, 'INVALID_EMAIL');
  });

  it('includes additional metadata when provided', () => {
    const result = createToolError('Database error', 'DatabaseError', 'DB_CONN_FAILED', {
      retryable: true,
      attempt: 3,
    });

    assert.deepEqual(result.content, [{ type: 'text', text: 'Database error' }]);
    assert.equal(result.isError, true);
    assert.deepEqual(result._meta, {
      errorType: 'DatabaseError',
      errorCode: 'DB_CONN_FAILED',
      retryable: true,
      attempt: 3,
    });
  });

  it('returns properly typed ToolError', () => {
    const result: ToolError = createToolError('Error', 'TestError');

    // Type assertion - if this compiles, type is correct
    assert.equal(result.isError, true);
    assert.equal(result._meta.errorType, 'TestError');
  });

  it('ToolError is assignable to ToolErrorStrict for application code', () => {
    // Factory returns ToolError, which can be used where ToolErrorStrict is expected
    // This enables strict type checking in application code
    const result: ToolErrorStrict = createToolError('Error', 'TestError');
    assert.equal(result.isError, true);
    assert.equal(result._meta.errorType, 'TestError');
  });
});

describe('Type narrowing with factory functions', () => {
  it('isToolError correctly identifies errors created with factory', () => {
    const error = createToolError('Test error', 'TestError');

    assert.equal(isToolError(error), true);
    assert.equal(isToolSuccess(error), false);

    if (isToolError(error)) {
      // TypeScript should narrow the type here
      assert.equal(error._meta.errorType, 'TestError');
    }
  });

  it('isToolSuccess correctly identifies success created with factory', () => {
    const success = createToolSuccess('Test success');

    assert.equal(isToolSuccess(success), true);
    assert.equal(isToolError(success), false);

    if (isToolSuccess(success)) {
      // TypeScript should allow accessing success-specific fields
      assert.equal(success.isError, false);
    }
  });

  it('discriminated union works with factory-created results', () => {
    const results: ToolResult[] = [
      createToolSuccess('Success 1'),
      createToolError('Error 1', 'Error1Type'),
      createToolSuccess('Success 2', { meta: 'data' }),
      createToolError('Error 2', 'Error2Type', 'ERR_CODE'),
    ];

    const errors = results.filter(isToolError);
    const successes = results.filter(isToolSuccess);

    assert.equal(errors.length, 2);
    assert.equal(successes.length, 2);

    // Verify error types
    assert.equal(errors[0]._meta.errorType, 'Error1Type');
    assert.equal(errors[1]._meta.errorType, 'Error2Type');
    assert.equal(errors[1]._meta.errorCode, 'ERR_CODE');

    // Verify success content
    assert.equal(successes[0].content[0].text, 'Success 1');
    assert.equal(successes[1].content[0].text, 'Success 2');
  });
});

describe('isError discriminant validation', () => {
  it('success has isError set to false', () => {
    const result = createToolSuccess('Test');
    assert.equal(result.isError, false);
  });

  it('error has isError set to true', () => {
    const result = createToolError('Test', 'TestError');
    assert.equal(result.isError, true);
  });

  it('isError discriminant enables proper type narrowing', () => {
    const result: ToolResult = createToolError('Test', 'TestError');

    if (result.isError) {
      // TypeScript knows this is ToolError, so _meta.errorType exists
      assert.equal(result._meta.errorType, 'TestError');
    } else {
      // This branch shouldn't execute
      assert.fail('Should be an error result');
    }
  });
});

describe('Edge cases', () => {
  it('handles empty string text in success', () => {
    const result = createToolSuccess('');
    assert.equal(result.content[0].text, '');
  });

  it('handles empty string text in error', () => {
    const result = createToolError('', 'EmptyError');
    assert.equal(result.content[0].text, '');
    assert.equal(result._meta.errorType, 'EmptyError');
  });

  it('trims whitespace from errorType', () => {
    const result = createToolError('error', '  ValidationError  ');
    assert.equal(result._meta.errorType, 'ValidationError');
  });

  it('throws ValidationError when errorType is empty', () => {
    assert.throws(() => createToolError('error', ''), {
      name: 'ValidationError',
      message: /createToolError: errorType parameter cannot be empty/,
    });

    assert.throws(() => createToolError('error', '  '), {
      name: 'ValidationError',
      message: /createToolError: errorType parameter cannot be empty.*received '  '/,
    });
  });

  it('handles empty metadata object', () => {
    const result = createToolSuccess('Test', {});
    assert.deepEqual(result._meta, {});
  });

  it('preserves nested metadata structures', () => {
    const result = createToolSuccess('Test', {
      nested: { deep: { value: 123 } },
      array: [1, 2, 3],
    });

    assert.deepEqual(result._meta, {
      nested: { deep: { value: 123 } },
      array: [1, 2, 3],
    });
  });
});

describe('GitHubCliError exit code validation', () => {
  it('accepts valid Unix exit codes (0-255)', () => {
    assert.doesNotThrow(() => new GitHubCliError('msg', 0, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 1, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 127, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 255, 'stderr'));
  });

  it('accepts HTTP status codes (400-599)', () => {
    assert.doesNotThrow(() => new GitHubCliError('msg', 400, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 404, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 429, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 500, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 599, 'stderr'));
  });

  it('preserves -1 sentinel value', () => {
    const error = new GitHubCliError('Process did not run', -1, 'stderr');
    assert.equal(error.exitCode, -1);
    assert.equal(error.message, 'Process did not run');
  });

  it('throws ValidationError for invalid exit codes', () => {
    // Negative codes (except -1)
    assert.throws(() => new GitHubCliError('msg', -5, 'stderr'), /Invalid exit\/status code: -5/);

    // Gap between Unix and HTTP codes (256-399)
    assert.throws(() => new GitHubCliError('msg', 256, 'stderr'), /Invalid exit\/status code: 256/);
    assert.throws(() => new GitHubCliError('msg', 399, 'stderr'), /Invalid exit\/status code: 399/);

    // Above HTTP status codes (600+)
    assert.throws(() => new GitHubCliError('msg', 600, 'stderr'), /Invalid exit\/status code: 600/);
  });

  it('accepts optional stdout parameter', () => {
    const error = new GitHubCliError('msg', 1, 'stderr', 'stdout');
    assert.equal(error.stdout, 'stdout');
  });
});

describe('isSystemError', () => {
  it('identifies system error codes', () => {
    assert.equal(isSystemError({ code: 'ENOMEM' }), true);
    assert.equal(isSystemError({ code: 'ENOSPC' }), true);
    assert.equal(isSystemError({ code: 'EMFILE' }), true);
    assert.equal(isSystemError({ code: 'ENFILE' }), true);
  });

  it('rejects non-system error codes', () => {
    assert.equal(isSystemError({ code: 'ENOENT' }), false);
    assert.equal(isSystemError({ code: 'EPERM' }), false);
    assert.equal(isSystemError(new Error('msg')), false);
  });

  it('handles edge cases', () => {
    assert.equal(isSystemError(null), false);
    assert.equal(isSystemError(undefined), false);
    assert.equal(isSystemError('string'), false);
    assert.equal(isSystemError({}), false);
  });
});

describe('Factory function validation', () => {
  it('createToolSuccess throws ValidationError for null text', () => {
    assert.throws(() => createToolSuccess(null as any), {
      name: 'ValidationError',
      message: /createToolSuccess: text parameter is required.*Expected string, received null/,
    });
  });

  it('createToolSuccess throws ValidationError for undefined text', () => {
    assert.throws(() => createToolSuccess(undefined as any), {
      name: 'ValidationError',
      message: /createToolSuccess: text parameter is required.*Expected string, received undefined/,
    });
  });

  it('createToolError throws ValidationError for null text', () => {
    assert.throws(() => createToolError(null as any, 'TestError'), {
      name: 'ValidationError',
      message: /createToolError: text parameter is required.*Expected string, received null/,
    });
  });

  it('createToolError throws ValidationError for undefined text', () => {
    assert.throws(() => createToolError(undefined as any, 'TestError'), {
      name: 'ValidationError',
      message: /createToolError: text parameter is required.*Expected string, received undefined/,
    });
  });

  it('createToolError throws ValidationError for null errorType', () => {
    assert.throws(() => createToolError('Error message', null as any), {
      name: 'ValidationError',
      message: /createToolError: errorType parameter is required.*Expected string, received null/,
    });
  });

  it('createToolError throws ValidationError for undefined errorType', () => {
    assert.throws(() => createToolError('Error message', undefined as any), {
      name: 'ValidationError',
      message:
        /createToolError: errorType parameter is required.*Expected string, received undefined/,
    });
  });

  it('createToolError throws ValidationError for reserved key "isError" in dev mode', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      assert.throws(() => createToolError('Error', 'TestError', undefined, { isError: false }), {
        name: 'ValidationError',
        message: /meta contains reserved keys \(isError, content\)/,
      });
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('createToolError throws ValidationError for reserved key "content" in dev mode', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      assert.throws(() => createToolError('Error', 'TestError', undefined, { content: [] }), {
        name: 'ValidationError',
        message: /meta contains reserved keys \(isError, content\)/,
      });
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('createToolError does not throw for reserved keys in production', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      // Should not throw, just warn (captured in console.warn)
      assert.doesNotThrow(() =>
        createToolError('Error', 'TestError', undefined, { isError: false })
      );
      assert.doesNotThrow(() => createToolError('Error', 'TestError', undefined, { content: [] }));
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe('Immutability tests', () => {
  it('prevents mutation of ToolSuccess result object', () => {
    const result = createToolSuccess('test', { key: 'value' });

    // Attempting to mutate should throw in strict mode
    assert.throws(() => {
      (result as any).isError = true;
    });
  });

  it('content array freeze behavior (shallow vs deep)', () => {
    const result = createToolSuccess('test');

    // Try to mutate the content array
    try {
      result.content.push({ type: 'text', text: 'new' } as any);
      // If push succeeded, we have shallow freeze (current behavior)
      assert.equal(result.content.length, 2, 'Shallow freeze: array is mutable');
    } catch (error) {
      // If push threw, we have deep freeze (future enhancement)
      assert.equal(result.content.length, 1, 'Deep freeze: array is immutable');
    }
  });

  it('prevents mutation of ToolError result object', () => {
    const result = createToolError('test', 'TestError');

    // Attempting to mutate should throw in strict mode
    assert.throws(() => {
      (result as any).isError = false;
    });
  });

  it('prevents mutation of ToolError _meta', () => {
    const result = createToolError('test', 'TestError');

    // Attempting to mutate _meta should throw
    assert.throws(() => {
      (result as any)._meta.errorType = 'changed';
    });
  });

  it('prevents mutation of ToolSuccess _meta when provided', () => {
    const result = createToolSuccess('test', { key: 'value' });

    // Attempting to mutate _meta should throw
    assert.throws(() => {
      (result as any)._meta.key = 'changed';
    });
  });

  it('nested objects in _meta remain mutable (shallow freeze)', () => {
    const result = createToolSuccess('test', { nested: { value: 123 } });

    // Nested objects are NOT frozen (this is documented behavior)
    assert.doesNotThrow(() => {
      if (result._meta && 'nested' in result._meta) {
        (result._meta.nested as any).value = 456;
      }
    });

    // Verify the mutation actually happened (shallow freeze limitation)
    if (result._meta && 'nested' in result._meta) {
      assert.equal((result._meta.nested as any).value, 456);
    }
  });
});

describe('Array validation', () => {
  it('throws ValidationError when text is an array in createToolSuccess', () => {
    assert.throws(() => createToolSuccess([] as any), {
      name: 'ValidationError',
      message: /text parameter must be a string, not an array/,
    });
  });

  it('throws ValidationError when text is an array in createToolError', () => {
    assert.throws(() => createToolError([] as any, 'Error'), {
      name: 'ValidationError',
      message: /text parameter must be a string, not an array/,
    });
  });
});

describe('validateToolResult', () => {
  it('validates ToolSuccess created by factory', () => {
    const result = createToolSuccess('test');
    assert.equal(validateToolResult(result), true);
  });

  it('validates ToolError created by factory', () => {
    const result = createToolError('error', 'TestError');
    assert.equal(validateToolResult(result), true);
  });

  it('validates manually constructed ToolSuccess', () => {
    const result = {
      content: [{ type: 'text', text: 'test' }],
      isError: false,
    };
    assert.equal(validateToolResult(result), true);
  });

  it('validates manually constructed ToolError', () => {
    const result = {
      content: [{ type: 'text', text: 'error' }],
      isError: true,
      _meta: { errorType: 'TestError' },
    };
    assert.equal(validateToolResult(result), true);
  });

  it('rejects null', () => {
    assert.equal(validateToolResult(null), false);
  });

  it('rejects undefined', () => {
    assert.equal(validateToolResult(undefined), false);
  });

  it('rejects non-objects', () => {
    assert.equal(validateToolResult('string'), false);
    assert.equal(validateToolResult(123), false);
    assert.equal(validateToolResult(true), false);
  });

  it('rejects objects missing isError', () => {
    const invalid = {
      content: [{ type: 'text', text: 'test' }],
    };
    assert.equal(validateToolResult(invalid), false);
  });

  it('rejects objects missing content', () => {
    const invalid = {
      isError: false,
    };
    assert.equal(validateToolResult(invalid), false);
  });

  it('rejects objects with empty content array', () => {
    const invalid = {
      content: [],
      isError: false,
    };
    assert.equal(validateToolResult(invalid), false);
  });

  it('rejects objects with non-array content', () => {
    const invalid = {
      content: 'not an array',
      isError: false,
    };
    assert.equal(validateToolResult(invalid), false);
  });

  it('rejects error results without _meta', () => {
    const invalid = {
      content: [{ type: 'text', text: 'error' }],
      isError: true,
    };
    assert.equal(validateToolResult(invalid), false);
  });

  it('rejects error results without errorType in _meta', () => {
    const invalid = {
      content: [{ type: 'text', text: 'error' }],
      isError: true,
      _meta: { someOtherField: 'value' },
    };
    assert.equal(validateToolResult(invalid), false);
  });

  it('rejects error results with empty errorType', () => {
    const invalid = {
      content: [{ type: 'text', text: 'error' }],
      isError: true,
      _meta: { errorType: '' },
    };
    assert.equal(validateToolResult(invalid), false);
  });

  it('rejects error results with non-string errorType', () => {
    const invalid = {
      content: [{ type: 'text', text: 'error' }],
      isError: true,
      _meta: { errorType: 123 },
    };
    assert.equal(validateToolResult(invalid), false);
  });

  it('provides type narrowing for valid results', () => {
    const data: unknown = createToolSuccess('test');
    if (validateToolResult(data)) {
      // TypeScript should narrow the type to ToolResult
      const result: ToolResult = data;
      assert.equal(result.isError, false);
    }
  });
});
