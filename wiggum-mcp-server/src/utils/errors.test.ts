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
    const error = new McpError('Test error', 'TEST_CODE');
    assert.strictEqual(error.message, 'Test error');
    assert.strictEqual(error.code, 'TEST_CODE');
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
    const error = new GitHubCliError('Command failed', undefined, undefined, cause);
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

  it('should create StateApiError with all fields', () => {
    const cause = new Error('Rate limit exceeded');
    const error = new StateApiError('Failed to read PR state', 'read', 'pr', 123, cause);
    assert.strictEqual(error.message, 'Failed to read PR state');
    assert.strictEqual(error.code, 'STATE_API_ERROR');
    assert.strictEqual(error.name, 'StateApiError');
    assert.strictEqual(error.operation, 'read');
    assert.strictEqual(error.resourceType, 'pr');
    assert.strictEqual(error.resourceId, 123);
    assert.strictEqual(error.cause, cause);
  });

  it('should create StateApiError without optional fields', () => {
    const error = new StateApiError('Failed to write issue state', 'write', 'issue');
    assert.strictEqual(error.message, 'Failed to write issue state');
    assert.strictEqual(error.code, 'STATE_API_ERROR');
    assert.strictEqual(error.name, 'StateApiError');
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

    assert.strictEqual(result._meta?.errorType, 'GitError');
    assert.strictEqual(result._meta?.errorCode, 'GIT_ERROR');
  });

  it('should create error result for FormattingError', () => {
    const error = new FormattingError('Invalid format');
    const result = createErrorResult(error);

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
    const error = new StateApiError('API operation failed', 'read', 'pr', 456);
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
    assert.strictEqual(formatError(error), 'Test error');
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
    const error = new StateApiError('API failed', 'read', 'pr');
    assert.strictEqual(isTerminalError(error), false);
  });
});
