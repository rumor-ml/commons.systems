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
    const result = createToolError(
      'Database error',
      'DatabaseError',
      'DB_CONN_FAILED',
      { retryable: true, attempt: 3 }
    );

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

  it('should throw when errorType is empty', () => {
    assert.throws(() => createToolError('error', ''), /errorType is required/);
    assert.throws(() => createToolError('error', '  '), /errorType is required/);
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
