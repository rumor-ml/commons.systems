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
    const error = new GitError('Git failed', 128, 'fatal error');
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
    const error = new GitError('Git failed');
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

  it('should return ValidationError for zero resourceId (never throws)', () => {
    const result = StateApiError.create('Failed', 'read', 'pr', 0);
    assert.ok(result instanceof ValidationError, 'Should return ValidationError, not throw');
    assert.ok(result.message.includes('resourceId must be a positive integer'));
    assert.ok(result.message.includes('0'));
  });

  it('should return ValidationError for negative resourceId (never throws)', () => {
    const result = StateApiError.create('Failed', 'read', 'pr', -1);
    assert.ok(result instanceof ValidationError, 'Should return ValidationError, not throw');
    assert.ok(result.message.includes('resourceId must be a positive integer'));
    assert.ok(result.message.includes('-1'));
  });

  it('should return ValidationError for non-integer resourceId (never throws)', () => {
    const result = StateApiError.create('Failed', 'read', 'pr', 3.5);
    assert.ok(result instanceof ValidationError, 'Should return ValidationError, not throw');
    assert.ok(result.message.includes('resourceId must be a positive integer'));
    assert.ok(result.message.includes('3.5'));
  });

  it('should return ValidationError for NaN resourceId (never throws)', () => {
    const result = StateApiError.create('Failed', 'read', 'pr', NaN);
    assert.ok(result instanceof ValidationError, 'Should return ValidationError, not throw');
    assert.ok(result.message.includes('resourceId must be a positive integer'));
    assert.ok(result.message.includes('NaN'));
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

  it('should return ValidationError when resourceId is invalid (cause is not preserved)', () => {
    const cause = new Error('Network error');
    const result = StateApiError.create('Failed', 'read', 'pr', -1, cause);
    assert.ok(result instanceof ValidationError);
    assert.ok(result.message.includes('resourceId must be a positive integer'));
  });
});
