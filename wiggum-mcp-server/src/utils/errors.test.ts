/**
 * Tests for error handling utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  GitError,
  FormattingError,
  StateDetectionError,
  StateApiError,
  createErrorResult,
  formatError,
  isTerminalError,
} from './errors.js';

describe('Error Classes', () => {
  it('should create McpError with message and code', () => {
    const error = new McpError('Test error', 'TIMEOUT');
    assert.strictEqual(error.message, 'Test error');
    assert.strictEqual(error.code, 'TIMEOUT');
    assert.strictEqual(error.name, 'McpError');
  });

  it('should create TimeoutError', () => {
    const error = new TimeoutError('Operation timed out');
    assert.strictEqual(error.message, 'Operation timed out');
    assert.strictEqual(error.code, 'TIMEOUT');
    assert.strictEqual(error.name, 'TimeoutError');
  });

  it('should create ValidationError', () => {
    const error = new ValidationError('Invalid input');
    assert.strictEqual(error.message, 'Invalid input');
    assert.strictEqual(error.code, 'VALIDATION_ERROR');
    assert.strictEqual(error.name, 'ValidationError');
  });

  it('should create NetworkError', () => {
    const error = new NetworkError('Network failed');
    assert.strictEqual(error.message, 'Network failed');
    assert.strictEqual(error.code, 'NETWORK_ERROR');
    assert.strictEqual(error.name, 'NetworkError');
  });

  it('should create GitHubCliError with exit code and stderr', () => {
    const error = new GitHubCliError('Command failed', 1, 'stderr output');
    assert.strictEqual(error.message, 'Command failed');
    assert.strictEqual(error.code, 'GH_CLI_ERROR');
    assert.strictEqual(error.exitCode, 1);
    assert.strictEqual(error.stderr, 'stderr output');
    assert.strictEqual(error.name, 'GitHubCliError');
  });

  it('should create GitHubCliError with cause', () => {
    const cause = new Error('Original error');
    const error = new GitHubCliError('Command failed', undefined, undefined, undefined, cause);
    assert.strictEqual(error.cause, cause);
  });

  it('should create GitError with exit code and stderr', () => {
    const error = GitError.create('Git failed', 128, 'fatal error');
    assert.strictEqual(error.message, 'Git failed');
    assert.strictEqual(error.code, 'GIT_ERROR');
    assert.strictEqual(error.exitCode, 128);
    assert.strictEqual(error.stderr, 'fatal error');
    assert.strictEqual(error.name, 'GitError');
  });

  it('should create FormattingError', () => {
    const error = new FormattingError('Invalid format');
    assert.strictEqual(error.message, 'Invalid format');
    assert.strictEqual(error.code, 'FORMATTING_ERROR');
    assert.strictEqual(error.name, 'FormattingError');
  });

  it('should create StateDetectionError with context', () => {
    const error = new StateDetectionError('Rapid PR changes', {
      depth: 3,
      maxDepth: 3,
      previousState: 'PR #123',
      newState: 'PR #124',
    });
    assert.strictEqual(error.message, 'Rapid PR changes');
    assert.strictEqual(error.code, 'STATE_DETECTION_ERROR');
    assert.strictEqual(error.name, 'StateDetectionError');
    assert.strictEqual(error.context?.depth, 3);
    assert.strictEqual(error.context?.maxDepth, 3);
    assert.strictEqual(error.context?.previousState, 'PR #123');
    assert.strictEqual(error.context?.newState, 'PR #124');
  });

  it('should create StateDetectionError without context', () => {
    const error = new StateDetectionError('Detection failed');
    assert.strictEqual(error.message, 'Detection failed');
    assert.strictEqual(error.code, 'STATE_DETECTION_ERROR');
    assert.strictEqual(error.name, 'StateDetectionError');
    assert.strictEqual(error.context, undefined);
  });

  it('should create StateApiError with all fields via factory', () => {
    const cause = new Error('Rate limit exceeded');
    const error = StateApiError.create('Failed to read PR state', 'read', 'pr', 123, cause);
    assert.strictEqual(error.message, 'Failed to read PR state');
    assert.strictEqual(error.code, 'STATE_API_ERROR');
    assert.strictEqual(error.name, 'StateApiError');
    assert.ok(error instanceof StateApiError);
    assert.strictEqual(error.operation, 'read');
    assert.strictEqual(error.resourceType, 'pr');
    assert.strictEqual(error.resourceId, 123);
    assert.strictEqual(error.cause, cause);
  });

  it('should create StateApiError without optional fields via factory', () => {
    const error = StateApiError.create('Failed to write issue state', 'write', 'issue');
    assert.strictEqual(error.message, 'Failed to write issue state');
    assert.strictEqual(error.code, 'STATE_API_ERROR');
    assert.strictEqual(error.name, 'StateApiError');
    assert.ok(error instanceof StateApiError);
    assert.strictEqual(error.operation, 'write');
    assert.strictEqual(error.resourceType, 'issue');
    assert.strictEqual(error.resourceId, undefined);
    assert.strictEqual(error.cause, undefined);
  });
});

describe('createErrorResult', () => {
  it('should create error result for TimeoutError', () => {
    const error = new TimeoutError('Timed out');
    const result = createErrorResult(error);

    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.content[0].type, 'text');
    assert.strictEqual(result.content[0].text, 'Error: Timed out');
    assert.strictEqual(result._meta?.errorType, 'TimeoutError');
    assert.strictEqual(result._meta?.errorCode, 'TIMEOUT');
  });

  it('should create error result for ValidationError', () => {
    const error = new ValidationError('Invalid');
    const result = createErrorResult(error);

    assert.strictEqual(result._meta?.errorType, 'ValidationError');
    assert.strictEqual(result._meta?.errorCode, 'VALIDATION_ERROR');
  });

  it('should create error result for NetworkError', () => {
    const error = new NetworkError('Network issue');
    const result = createErrorResult(error);

    assert.strictEqual(result._meta?.errorType, 'NetworkError');
    assert.strictEqual(result._meta?.errorCode, 'NETWORK_ERROR');
  });

  it('should create error result for GitHubCliError', () => {
    const error = new GitHubCliError('CLI failed');
    const result = createErrorResult(error);

    assert.strictEqual(result._meta?.errorType, 'GitHubCliError');
    assert.strictEqual(result._meta?.errorCode, 'GH_CLI_ERROR');
  });

  it('should create error result for GitError', () => {
    const error = GitError.create('Git failed');
    const result = createErrorResult(error);

    // GitError extends McpError, so it's handled as McpError with specific code
    assert.strictEqual(result._meta?.errorType, 'McpError');
    assert.strictEqual(result._meta?.errorCode, 'GIT_ERROR');
  });

  it('should create error result for FormattingError', () => {
    const error = new FormattingError('Invalid format');
    const result = createErrorResult(error);

    // FormattingError now has explicit instanceof handling in createErrorResultFromError
    assert.strictEqual(result._meta?.errorType, 'FormattingError');
    assert.strictEqual(result._meta?.errorCode, 'FORMATTING_ERROR');
  });

  it('should create error result for StateDetectionError', () => {
    const error = new StateDetectionError('State detection failed', {
      depth: 2,
      maxDepth: 3,
    });
    const result = createErrorResult(error);

    assert.strictEqual(result._meta?.errorType, 'StateDetectionError');
    assert.strictEqual(result._meta?.errorCode, 'STATE_DETECTION_ERROR');
    assert.strictEqual(result.content[0].text, 'Error: State detection failed');
  });

  it('should create error result for StateApiError', () => {
    const error = StateApiError.create('API operation failed', 'read', 'pr', 456);
    const result = createErrorResult(error);

    assert.strictEqual(result._meta?.errorType, 'StateApiError');
    assert.strictEqual(result._meta?.errorCode, 'STATE_API_ERROR');
    assert.strictEqual(result.content[0].text, 'Error: API operation failed');
  });

  it('should create error result for generic Error', () => {
    const error = new Error('Generic error');
    const result = createErrorResult(error);

    assert.strictEqual(result.content[0].text, 'Error: Generic error');
    assert.strictEqual(result._meta?.errorType, 'UnknownError');
  });

  it('should create error result for string error', () => {
    const result = createErrorResult('String error');

    assert.strictEqual(result.content[0].text, 'Error: String error');
    assert.strictEqual(result._meta?.errorType, 'UnknownError');
  });
});

describe('formatError', () => {
  it('should format Error object', () => {
    const error = new Error('Test error');
    // formatError from mcp-common includes error type prefix
    assert.strictEqual(formatError(error), '[Error] Test error');
  });

  it('should format string error', () => {
    assert.strictEqual(formatError('String error'), 'String error');
  });

  it('should format non-string, non-Error values', () => {
    assert.strictEqual(formatError(123), '123');
    assert.strictEqual(formatError(null), 'null');
  });
});

describe('isTerminalError', () => {
  it('should return true for ValidationError', () => {
    const error = new ValidationError('Bad input');
    assert.strictEqual(isTerminalError(error), true);
  });

  it('should return false for TimeoutError', () => {
    const error = new TimeoutError('Timed out');
    assert.strictEqual(isTerminalError(error), false);
  });

  it('should return false for NetworkError', () => {
    const error = new NetworkError('Network issue');
    assert.strictEqual(isTerminalError(error), false);
  });

  it('should return false for generic Error', () => {
    const error = new Error('Generic');
    assert.strictEqual(isTerminalError(error), false);
  });

  it('should treat StateDetectionError as terminal', () => {
    const error = new StateDetectionError('Detection failed');
    assert.strictEqual(isTerminalError(error), true);
  });

  it('should treat StateApiError as retryable (not terminal)', () => {
    const error = StateApiError.create('API failed', 'read', 'pr');
    assert.strictEqual(isTerminalError(error), false);
  });
});

describe('StateApiError.create() factory function', () => {
  it('should return StateApiError for valid resourceId', () => {
    const result = StateApiError.create('Failed', 'read', 'pr', 42);
    assert.ok(result instanceof StateApiError, 'Should return StateApiError');
    assert.strictEqual(result.resourceId, 42);
    assert.strictEqual(result.message, 'Failed');
  });

  it('should return StateApiError for undefined resourceId', () => {
    const result = StateApiError.create('Failed', 'read', 'issue');
    assert.ok(result instanceof StateApiError, 'Should return StateApiError');
    assert.strictEqual(result.resourceId, undefined);
  });

  it('should throw ValidationError for zero resourceId', () => {
    assert.throws(
      () => StateApiError.create('Failed', 'read', 'pr', 0),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('resourceId must be a positive integer') &&
          error.message.includes('0')
        );
      },
      'Should throw ValidationError for zero resourceId'
    );
  });

  it('should throw ValidationError for negative resourceId', () => {
    assert.throws(
      () => StateApiError.create('Failed', 'read', 'pr', -1),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('resourceId must be a positive integer') &&
          error.message.includes('-1')
        );
      },
      'Should throw ValidationError for negative resourceId'
    );
  });

  it('should throw ValidationError for non-integer resourceId', () => {
    assert.throws(
      () => StateApiError.create('Failed', 'read', 'pr', 3.5),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('resourceId must be a positive integer') &&
          error.message.includes('3.5')
        );
      },
      'Should throw ValidationError for non-integer resourceId'
    );
  });

  it('should throw ValidationError for NaN resourceId', () => {
    assert.throws(
      () => StateApiError.create('Failed', 'read', 'pr', NaN),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('resourceId must be a positive integer') &&
          error.message.includes('NaN')
        );
      },
      'Should throw ValidationError for NaN resourceId'
    );
  });

  it('should preserve operation and resourceType', () => {
    const result = StateApiError.create('Failed', 'write', 'issue', 99);
    assert.ok(result instanceof StateApiError);
    assert.strictEqual(result.operation, 'write');
    assert.strictEqual(result.resourceType, 'issue');
  });

  it('should preserve cause in factory function', () => {
    const cause = new Error('Network error');
    const result = StateApiError.create('Failed', 'read', 'pr', 100, cause);
    assert.ok(result instanceof StateApiError);
    assert.strictEqual(result.cause, cause);
  });

  it('should throw ValidationError when resourceId is invalid (cause is not preserved)', () => {
    const cause = new Error('Network error');
    assert.throws(
      () => StateApiError.create('Failed', 'read', 'pr', -1, cause),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('resourceId must be a positive integer')
        );
      },
      'Should throw ValidationError for invalid resourceId'
    );
  });

  it('should enforce factory pattern via private constructor', () => {
    // This test documents that direct instantiation is not allowed.
    // If someone attempts: new StateApiError('msg', 'read', 'pr', 123)
    // TypeScript will fail compilation with: "Constructor of class 'StateApiError' is private"
    // This prevents the dual-pattern problem described in issue #852.

    // Must use factory method instead
    const error = StateApiError.create('msg', 'read', 'pr', 123);
    assert.ok(error instanceof StateApiError);
    assert.strictEqual(error.message, 'msg');
    assert.strictEqual(error.operation, 'read');
    assert.strictEqual(error.resourceType, 'pr');
    assert.strictEqual(error.resourceId, 123);
  });
});

describe('GitError.create() factory function', () => {
  it('should return GitError for valid exitCode 0 with stderr', () => {
    const result = GitError.create('Git failed', 0, 'error output');
    assert.ok(result instanceof GitError, 'Should return GitError');
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stderr, 'error output');
    assert.strictEqual(result.message, 'Git failed');
  });

  it('should return GitError for valid exitCode 128 with stderr', () => {
    const result = GitError.create('Git failed', 128, 'fatal: not a git repository');
    assert.ok(result instanceof GitError, 'Should return GitError');
    assert.strictEqual(result.exitCode, 128);
    assert.strictEqual(result.stderr, 'fatal: not a git repository');
  });

  it('should return GitError for valid exitCode 255 with stderr', () => {
    const result = GitError.create('Git failed', 255, 'error');
    assert.ok(result instanceof GitError, 'Should return GitError');
    assert.strictEqual(result.exitCode, 255);
    assert.strictEqual(result.stderr, 'error');
  });

  it('should return GitError for undefined exitCode and stderr', () => {
    const result = GitError.create('Git failed');
    assert.ok(result instanceof GitError, 'Should return GitError');
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.stderr, undefined);
  });

  it('should return GitError for exitCode without stderr', () => {
    const result = GitError.create('Git failed', 1);
    assert.ok(result instanceof GitError, 'Should return GitError');
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.stderr, undefined);
  });

  it('should throw ValidationError for negative exitCode', () => {
    assert.throws(
      () => GitError.create('Git failed', -1, 'error'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('exitCode must be an integer in range 0-255') &&
          error.message.includes('-1')
        );
      },
      'Should throw ValidationError for negative exitCode'
    );
  });

  it('should throw ValidationError for exitCode greater than 255', () => {
    assert.throws(
      () => GitError.create('Git failed', 256, 'error'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('exitCode must be an integer in range 0-255') &&
          error.message.includes('256')
        );
      },
      'Should throw ValidationError for exitCode > 255'
    );
  });

  it('should throw ValidationError for non-integer exitCode', () => {
    assert.throws(
      () => GitError.create('Git failed', 1.5, 'error'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('exitCode must be an integer in range 0-255') &&
          error.message.includes('1.5')
        );
      },
      'Should throw ValidationError for non-integer exitCode'
    );
  });

  it('should throw ValidationError for NaN exitCode', () => {
    assert.throws(
      () => GitError.create('Git failed', NaN, 'error'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('exitCode must be an integer in range 0-255') &&
          error.message.includes('NaN')
        );
      },
      'Should throw ValidationError for NaN exitCode'
    );
  });

  // TODO(#1658): Consider testing stderr with special characters (unicode, null bytes, ANSI codes)
  it('should throw ValidationError for empty string stderr', () => {
    assert.throws(
      () => GitError.create('Git failed', 1, ''),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('stderr cannot be empty or whitespace-only') &&
          error.message.includes('use undefined instead')
        );
      },
      'Should throw ValidationError for empty string stderr'
    );
  });

  it('should throw ValidationError for empty string stderr without exitCode', () => {
    assert.throws(
      () => GitError.create('Git failed', undefined, ''),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('stderr cannot be empty or whitespace-only') &&
          error.message.includes('use undefined instead')
        );
      },
      'Should throw ValidationError for empty string stderr'
    );
  });

  it('should enforce factory pattern via private constructor', () => {
    // This test documents that direct instantiation is not allowed.
    // If someone attempts: new GitError('msg', 128, 'error')
    // TypeScript will fail compilation with: "Constructor of class 'GitError' is private"
    // This prevents the dual-pattern problem described in issue #852.
    // TODO(#1659): Update or clarify issue reference in comment

    // Must use factory method instead
    const error = GitError.create('msg', 128, 'fatal error');
    assert.ok(error instanceof GitError);
    assert.strictEqual(error.message, 'msg');
    assert.strictEqual(error.exitCode, 128);
    assert.strictEqual(error.stderr, 'fatal error');
  });
});

describe('GitError.create() validation edge cases', () => {
  it('should throw ValidationError for empty string message', () => {
    assert.throws(
      () => GitError.create('', 1, 'error'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('message cannot be empty or whitespace-only')
        );
      },
      'Should throw ValidationError for empty message'
    );
  });

  it('should throw ValidationError for whitespace-only message', () => {
    assert.throws(
      () => GitError.create('   ', 1, 'error'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('message cannot be empty or whitespace-only')
        );
      },
      'Should throw ValidationError for whitespace-only message'
    );
  });

  it('should throw ValidationError for whitespace-only stderr (spaces)', () => {
    assert.throws(
      () => GitError.create('Git failed', 1, '   '),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('stderr cannot be empty or whitespace-only')
        );
      },
      'Should throw ValidationError for whitespace-only stderr'
    );
  });

  it('should throw ValidationError for whitespace-only stderr (tabs)', () => {
    assert.throws(
      () => GitError.create('Git failed', 1, '\t'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('stderr cannot be empty or whitespace-only')
        );
      },
      'Should throw ValidationError for tab-only stderr'
    );
  });

  it('should throw ValidationError for whitespace-only stderr (newlines)', () => {
    assert.throws(
      () => GitError.create('Git failed', 1, '\n'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('stderr cannot be empty or whitespace-only')
        );
      },
      'Should throw ValidationError for newline-only stderr'
    );
  });

  it('should throw ValidationError for whitespace-only stderr (mixed)', () => {
    assert.throws(
      () => GitError.create('Git failed', 1, '  \n\t  '),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('stderr cannot be empty or whitespace-only')
        );
      },
      'Should throw ValidationError for mixed whitespace stderr'
    );
  });

  it('should throw ValidationError for Infinity exitCode', () => {
    assert.throws(
      () => GitError.create('Git failed', Infinity, 'error'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('exitCode must be an integer in range 0-255') &&
          error.message.includes('Infinity')
        );
      },
      'Should throw ValidationError for Infinity exitCode'
    );
  });

  it('should throw ValidationError for -Infinity exitCode', () => {
    assert.throws(
      () => GitError.create('Git failed', -Infinity, 'error'),
      (error: unknown) => {
        return (
          error instanceof ValidationError &&
          error.message.includes('exitCode must be an integer in range 0-255') &&
          error.message.includes('-Infinity')
        );
      },
      'Should throw ValidationError for -Infinity exitCode'
    );
  });

  it('should return GitError for stderr without exitCode', () => {
    const result = GitError.create('Git failed', undefined, 'fatal: repository not found');
    assert.ok(result instanceof GitError, 'Should return GitError');
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.stderr, 'fatal: repository not found');
    assert.strictEqual(result.message, 'Git failed');
  });

  it('should handle very long stderr strings', () => {
    const longStderr = 'error: '.repeat(10000); // ~70KB string
    const result = GitError.create('Git failed', 1, longStderr);
    assert.ok(result instanceof GitError);
    assert.strictEqual(result.stderr, longStderr);
    assert.strictEqual(result.stderr.length, longStderr.length);
  });
});
