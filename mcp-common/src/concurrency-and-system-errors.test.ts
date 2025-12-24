/**
 * Concurrency, system error, and cause chain tests for mcp-common
 *
 * Tests for:
 * - Concurrent error creation and mutation safety
 * - Real Node.js system error handling
 * - Error cause chain preservation
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GitHubCliError, NetworkError, ParsingError } from './errors.js';
import { createErrorResult } from './result-builders.js';
import { createToolSuccess } from './types.js';

describe('Concurrency: Mutation safety', () => {
  it('concurrent error creation does not share mutable state', async () => {
    // Create two results concurrently with nested metadata
    const results = await Promise.all([
      Promise.resolve(createToolSuccess('test1', { data: { count: 0 } })),
      Promise.resolve(createToolSuccess('test2', { data: { count: 0 } })),
    ]);

    // Attempt to mutate nested object in first result
    if (results[0]._meta?.data) {
      (results[0]._meta.data as any).count = 999;
    }

    // Second result should be affected due to shallow freeze
    // This documents the CURRENT behavior (shallow freeze limitation)
    // If this test fails after implementing deep freeze, update the assertion
    assert.equal(
      (results[1]._meta?.data as any).count,
      0,
      'Second result should have independent data (with deep freeze)'
    );

    // Note: This test currently documents that shallow freeze ALLOWS this mutation
    // The mutation affects results[0] but not results[1] because each call
    // creates a new object. The shallow freeze prevents top-level mutations only.
  });

  it('content array modifications are prevented by Object.freeze at top level', () => {
    const result = createToolSuccess('test');

    // Attempting to reassign content should fail (frozen)
    assert.throws(
      () => {
        (result as any).content = [];
      },
      TypeError,
      'Top-level properties should be frozen'
    );
  });

  it('documents shallow freeze limitation for nested structures', () => {
    const result = createToolSuccess('test', { items: [1, 2, 3] });

    // This mutation is ALLOWED with shallow freeze
    if (result._meta?.items && Array.isArray(result._meta.items)) {
      (result._meta.items as any[]).push(4);
      assert.equal(
        (result._meta.items as any[]).length,
        4,
        'Nested array mutations are not prevented by shallow freeze'
      );
    }

    // Document: Users should not rely on deep immutability
    // Recommendation: Always create new objects instead of mutating
  });
});

describe('System Errors: Real Node.js error objects', () => {
  it('re-throws real Node.js ENOMEM errors without modification', () => {
    // Create a realistic Node.js system error with all properties
    const realError = Object.assign(new Error('Cannot allocate memory'), {
      code: 'ENOMEM',
      errno: -12,
      syscall: 'spawn',
    });

    assert.throws(
      () => createErrorResult(realError),
      (err: any) => {
        // Verify EXACT object re-thrown (reference equality)
        assert.strictEqual(err, realError, 'Should re-throw the exact same error object');

        // Verify all properties preserved
        assert.equal(err.errno, -12, 'errno should be preserved');
        assert.equal(err.syscall, 'spawn', 'syscall should be preserved');
        assert.equal(err.code, 'ENOMEM', 'code should be preserved');

        return true;
      },
      'Should re-throw system error'
    );
  });

  it('re-throws ENOSPC error with all Node.js properties', () => {
    const realError = Object.assign(new Error('No space left on device'), {
      code: 'ENOSPC',
      errno: -28,
      syscall: 'write',
      path: '/tmp/output.log',
    });

    assert.throws(
      () => createErrorResult(realError),
      (err: any) => {
        assert.strictEqual(err, realError);
        assert.equal(err.errno, -28);
        assert.equal(err.syscall, 'write');
        assert.equal(err.path, '/tmp/output.log');
        return true;
      }
    );
  });

  it('converts EACCES error to ToolError (not a system error)', () => {
    // EACCES is recoverable (e.g., user can change permissions), not a system error
    const realError = Object.assign(new Error('Permission denied'), {
      code: 'EACCES',
      errno: -13,
      syscall: 'open',
      path: '/root/protected.file',
    });

    const result = createErrorResult(realError);
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes('Permission denied'));
    assert.equal(result._meta.errorType, 'UnknownError');
  });

  it('converts ENOENT error to ToolError (not a system error)', () => {
    // ENOENT is recoverable (file might be created), not a system error
    const realError = Object.assign(new Error('File not found'), {
      code: 'ENOENT',
      errno: -2,
      syscall: 'stat',
      path: '/missing/file.txt',
      dest: '/destination/path',
    });

    const result = createErrorResult(realError);
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes('File not found'));
    assert.equal(result._meta.errorType, 'UnknownError');
  });
});

describe('Error Cause Chains: Preservation through pipeline', () => {
  it('preserves error cause chain when converting to ToolError', () => {
    const rootCause = new NetworkError('Connection refused');
    const ghError = new GitHubCliError('gh api failed', 1, 'stderr', undefined, rootCause);
    createErrorResult(ghError);

    // Verify the original error preserves its cause
    assert.ok(ghError.cause === rootCause, 'Cause should be preserved on GitHubCliError object');
    assert.ok(ghError.cause instanceof NetworkError, 'Cause should maintain its type');
  });

  it('preserves multi-level cause chains', () => {
    const level3 = new Error('DNS lookup failed');
    const level2 = new NetworkError('Connection timeout');
    (level2 as any).cause = level3;

    const level1 = new GitHubCliError('API request failed', 1, 'stderr', undefined, level2);

    // Verify chain preservation
    assert.ok(level1.cause === level2, 'Level 1 cause should be level 2');
    assert.ok((level1.cause as any).cause === level3, 'Level 2 cause should be level 3');

    const result = createErrorResult(level1);
    assert.ok(result.content[0].text.includes('API request failed'));
  });

  it('ParsingError with JSON.parse error cause preserves details', () => {
    let jsonError: Error;
    try {
      JSON.parse('{ invalid json }');
    } catch (error) {
      jsonError = error as Error;
    }

    const parseError = new ParsingError('Failed to parse API response', jsonError!);

    // Verify cause preservation
    assert.ok(parseError.cause === jsonError!, 'Should preserve JSON parse error');
    assert.ok(
      parseError.cause instanceof SyntaxError,
      'JSON parse errors are SyntaxError instances'
    );

    const result = createErrorResult(parseError);
    assert.ok(result._meta.errorType === 'ParsingError');
  });

  it('GitHubCliError with undefined cause does not crash', () => {
    const error = new GitHubCliError('test', 1, 'stderr', 'stdout', undefined);

    assert.strictEqual(error.cause, undefined, 'Cause should be undefined when not provided');

    const result = createErrorResult(error);
    assert.ok(result._meta.errorType === 'GitHubCliError');
  });
});

describe('Edge Cases: Concurrent operations with errors', () => {
  it('concurrent error creation with different types', async () => {
    const errors = [
      new GitHubCliError('gh1', 1, 'err1'),
      new NetworkError('network1'),
      new ParsingError('parse1'),
    ];

    const results = await Promise.all(errors.map((err) => Promise.resolve(createErrorResult(err))));

    // Verify each result maintains its distinct type
    assert.equal(results[0]._meta.errorType, 'GitHubCliError');
    assert.equal(results[1]._meta.errorType, 'NetworkError');
    assert.equal(results[2]._meta.errorType, 'ParsingError');

    // Verify no cross-contamination
    assert.notEqual(results[0]._meta.errorType, results[1]._meta.errorType);
    assert.notEqual(results[1]._meta.errorType, results[2]._meta.errorType);
  });

  it('rapid sequential error creation maintains isolation', () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      const error = new GitHubCliError(`error${i}`, i, `stderr${i}`);
      results.push(createErrorResult(error));
    }

    // Verify each result has unique data
    for (let i = 0; i < 100; i++) {
      assert.ok(
        results[i].content[0].text.includes(`error${i}`),
        `Result ${i} should contain its unique message`
      );
      assert.equal(results[i]._meta.exitCode, i, `Result ${i} should have exit code ${i}`);
    }
  });
});
