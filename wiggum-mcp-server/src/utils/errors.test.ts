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
});
