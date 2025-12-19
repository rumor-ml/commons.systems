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
  type ToolResult,
  type ToolSuccess,
  type ToolError,
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

  it('uses safe defaults when errorType is empty', () => {
    const result1 = createToolError('error', '');
    assert.ok(result1.content[0].text.includes('Warning: errorType was empty'));
    assert.equal(result1._meta.errorType, 'UnknownError');

    const result2 = createToolError('error', '  ');
    assert.ok(result2.content[0].text.includes('Warning: errorType was empty'));
    assert.equal(result2._meta.errorType, 'UnknownError');
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
  it('accepts valid exit codes (0-255)', () => {
    assert.doesNotThrow(() => new GitHubCliError('msg', 0, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 1, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 127, 'stderr'));
    assert.doesNotThrow(() => new GitHubCliError('msg', 255, 'stderr'));
  });

  it('clamps invalid exit codes instead of throwing', () => {
    const error1 = new GitHubCliError('msg', -1, 'stderr');
    assert.equal(error1.exitCode, 0);
    assert.ok(error1.message.includes('Warning: Invalid exit code -1 clamped to 0'));

    const error2 = new GitHubCliError('msg', 256, 'stderr');
    assert.equal(error2.exitCode, 255);
    assert.ok(error2.message.includes('Warning: Invalid exit code 256 clamped to 255'));
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
  it('createToolSuccess handles null text with safe defaults', () => {
    const result = createToolSuccess(null as any);
    assert.ok(result.content[0].text.includes('Warning: success message was missing'));
    assert.ok(result.content[0].text.includes('[Error: missing success message]'));
  });

  it('createToolSuccess handles undefined text with safe defaults', () => {
    const result = createToolSuccess(undefined as any);
    assert.ok(result.content[0].text.includes('Warning: success message was missing'));
  });

  it('createToolError handles null text with safe defaults', () => {
    const result = createToolError(null as any, 'TestError');
    assert.ok(result.content[0].text.includes('Warning: error message was missing'));
    assert.ok(result.content[0].text.includes('[Error: missing error message]'));
  });

  it('createToolError handles undefined text with safe defaults', () => {
    const result = createToolError(undefined as any, 'TestError');
    assert.ok(result.content[0].text.includes('Warning: error message was missing'));
  });

  it('createToolError handles missing errorType with safe defaults', () => {
    const result = createToolError('Error message', null as any);
    assert.ok(result.content[0].text.includes('Warning: errorType was empty'));
    assert.equal(result._meta.errorType, 'UnknownError');
  });

  it('createToolError handles undefined errorType with safe defaults', () => {
    const result = createToolError('Error message', undefined as any);
    assert.ok(result.content[0].text.includes('Warning: errorType was empty'));
    assert.equal(result._meta.errorType, 'UnknownError');
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

  it('content array is mutable (shallow freeze limitation)', () => {
    const result = createToolSuccess('test');

    // The content array is NOT frozen (shallow freeze limitation)
    // This documents the actual behavior
    assert.doesNotThrow(() => {
      result.content.push({ type: 'text', text: 'new' } as any);
    });

    // Verify the mutation actually happened
    assert.equal(result.content.length, 2);
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
