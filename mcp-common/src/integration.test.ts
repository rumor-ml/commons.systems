/**
 * Integration tests for mcp-common modules
 *
 * Tests cross-module interactions between errors, types, and result-builders
 * to ensure the full error-handling pipeline works correctly.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  McpError,
  GitHubCliError,
  TimeoutError,
  ValidationError,
  NetworkError,
  ParsingError,
  FormattingError,
} from './errors.js';
import { createErrorResult } from './result-builders.js';
import { isToolError, isToolSuccess, validateToolResult } from './types.js';

describe('Integration: errors + types + result-builders', () => {
  describe('GitHubCliError metadata preservation', () => {
    it('createErrorResult preserves GitHubCliError metadata through type system', () => {
      const ghError = new GitHubCliError('cmd failed', 128, 'stderr output', 'stdout output');
      const result = createErrorResult(ghError);

      // Verify type narrowing works
      assert.ok(isToolError(result), 'Result should be ToolError');
      assert.equal(result.isError, true, 'isError should be true');

      // Verify metadata preservation
      assert.equal(result._meta.errorType, 'GitHubCliError');
      assert.equal(result._meta.errorCode, 'GH_CLI_ERROR');
      assert.equal(result._meta.exitCode, 128);
      assert.equal(result._meta.stderr, 'stderr output');
      assert.equal(result._meta.stdout, 'stdout output');

      // Verify result passes validation
      assert.ok(validateToolResult(result), 'Result should pass validation');
    });

    it('createErrorResult handles GitHubCliError with cause chain', () => {
      const rootCause = new Error('Network timeout');
      const ghError = new GitHubCliError('gh api failed', 1, 'stderr', undefined, rootCause);
      const result = createErrorResult(ghError);

      assert.ok(isToolError(result));
      assert.equal(result._meta.errorType, 'GitHubCliError');

      // Verify cause is accessible (even if not in _meta, it's on the error object)
      assert.ok(ghError.cause === rootCause, 'Cause should be preserved on error object');
    });
  });

  describe('ParsingError and FormattingError', () => {
    it('createErrorResult handles ParsingError correctly', () => {
      const parseError = new ParsingError('JSON parsing failed');
      const result = createErrorResult(parseError);

      assert.ok(isToolError(result));
      assert.equal(result._meta.errorType, 'ParsingError');
      assert.equal(result._meta.errorCode, 'PARSING_ERROR');
      assert.ok(validateToolResult(result));
    });

    it('createErrorResult handles FormattingError correctly', () => {
      const formatError = new FormattingError('Template formatting failed');
      const result = createErrorResult(formatError);

      assert.ok(isToolError(result));
      assert.equal(result._meta.errorType, 'FormattingError');
      assert.equal(result._meta.errorCode, 'FORMATTING_ERROR');
      assert.ok(validateToolResult(result));
    });

    it('ParsingError supports cause parameter', () => {
      const jsonError = new SyntaxError('Unexpected token');
      const parseError = new ParsingError('Failed to parse', jsonError);

      assert.ok(parseError.cause === jsonError, 'Cause should be preserved');

      const result = createErrorResult(parseError);
      assert.ok(isToolError(result));
      assert.equal(result._meta.errorType, 'ParsingError');
    });
  });

  describe('All error types through pipeline', () => {
    it('TimeoutError produces valid ToolError', () => {
      const error = new TimeoutError('Operation timed out after 30000ms');
      const result = createErrorResult(error);

      assert.ok(isToolError(result));
      assert.ok(!isToolSuccess(result));
      assert.equal(result._meta.errorType, 'TimeoutError');
      assert.equal(result._meta.errorCode, 'TIMEOUT');
      assert.ok(validateToolResult(result));
    });

    it('ValidationError produces valid ToolError', () => {
      const error = new ValidationError('Invalid parameter: foo must be positive');
      const result = createErrorResult(error);

      assert.ok(isToolError(result));
      assert.equal(result._meta.errorType, 'ValidationError');
      assert.ok(validateToolResult(result));
    });

    it('NetworkError produces valid ToolError', () => {
      const error = new NetworkError('Connection refused');
      const result = createErrorResult(error);

      assert.ok(isToolError(result));
      assert.equal(result._meta.errorType, 'NetworkError');
      assert.ok(validateToolResult(result));
    });

    it('Generic McpError produces valid ToolError', () => {
      const error = new McpError('Generic MCP error', 'GIT_ERROR');
      const result = createErrorResult(error);

      assert.ok(isToolError(result));
      assert.equal(result._meta.errorType, 'McpError');
      assert.equal(result._meta.errorCode, 'GIT_ERROR');
      assert.ok(validateToolResult(result));
    });
  });

  describe('Type guard consistency', () => {
    it('isToolError and isToolSuccess are mutually exclusive', () => {
      const error = new ValidationError('test error');
      const result = createErrorResult(error);

      assert.ok(
        isToolError(result) && !isToolSuccess(result),
        'ToolError should not be ToolSuccess'
      );
    });

    it('validateToolResult accepts all error results', () => {
      const errors = [
        new McpError('test', 'GIT_ERROR'),
        new TimeoutError('timeout'),
        new ValidationError('validation'),
        new NetworkError('network'),
        new GitHubCliError('gh cli', 1, 'stderr'),
        new ParsingError('parsing'),
        new FormattingError('formatting'),
      ];

      for (const error of errors) {
        const result = createErrorResult(error);
        assert.ok(validateToolResult(result), `${error.constructor.name} result should validate`);
      }
    });
  });
});

describe('Integration: System error re-throwing', () => {
  it('system errors are re-thrown without wrapping', () => {
    const systemError = Object.assign(new Error('Out of memory'), {
      code: 'ENOMEM',
    });

    assert.throws(
      () => createErrorResult(systemError),
      (err) => {
        // Should be the EXACT same object (reference equality)
        assert.strictEqual(err, systemError, 'Should re-throw exact same error object');
        assert.equal((err as any).code, 'ENOMEM');
        return true;
      },
      'System errors should be re-thrown'
    );
  });

  it('programming errors are handled with clear messaging', () => {
    const typeError = new TypeError('Cannot read property of undefined');
    const result = createErrorResult(typeError);

    assert.ok(isToolError(result));
    assert.ok(
      result.content[0].text.includes('Internal Error (Bug)'),
      'Should indicate programming error'
    );
    assert.ok(result.content[0].text.includes('TypeError'), 'Should mention error type');
    assert.equal(result._meta.isProgrammingError, true, 'Should flag as programming error');
  });
});
