/**
 * Example tests for error handling utilities
 *
 * This demonstrates testing patterns for MCP server code.
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  ParsingError,
  FormattingError,
  createErrorResult,
  isTerminalError,
} from './errors.js';

describe('Error Classes', () => {
  it('McpError includes error code', () => {
    const error = new McpError('Test error', 'TIMEOUT');
    assert.equal(error.message, 'Test error');
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.name, 'McpError');
  });

  it('TimeoutError has TIMEOUT code', () => {
    const error = new TimeoutError('Operation timed out');
    assert.equal(error.message, 'Operation timed out');
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.name, 'TimeoutError');
  });

  it('ValidationError has VALIDATION_ERROR code', () => {
    const error = new ValidationError('Invalid input');
    assert.equal(error.message, 'Invalid input');
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.name, 'ValidationError');
  });

  it('NetworkError has NETWORK_ERROR code', () => {
    const error = new NetworkError('Connection failed');
    assert.equal(error.message, 'Connection failed');
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.name, 'NetworkError');
  });

  it('GitHubCliError has GH_CLI_ERROR code', () => {
    const error = new GitHubCliError('Command failed', 1, 'stderr output');
    assert.equal(error.message, 'Command failed');
    assert.equal(error.code, 'GH_CLI_ERROR');
    assert.equal(error.exitCode, 1);
    assert.equal(error.stderr, 'stderr output');
    assert.equal(error.name, 'GitHubCliError');
  });

  it('GitHubCliError includes cause', () => {
    const cause = new Error('Original error');
    const error = new GitHubCliError('Command failed', undefined, undefined, undefined, cause);
    assert.equal(error.cause, cause);
  });

  it('ParsingError has PARSING_ERROR code', () => {
    const error = new ParsingError('Failed to parse JSON');
    assert.equal(error.message, 'Failed to parse JSON');
    assert.equal(error.code, 'PARSING_ERROR');
    assert.equal(error.name, 'ParsingError');
  });

  it('FormattingError has FORMATTING_ERROR code', () => {
    const error = new FormattingError('Invalid format');
    assert.equal(error.message, 'Invalid format');
    assert.equal(error.code, 'FORMATTING_ERROR');
    assert.equal(error.name, 'FormattingError');
  });
});

describe('createErrorResult', () => {
  it('categorizes TimeoutError correctly', () => {
    const error = new TimeoutError('Timed out');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal(result.content[0]?.type, 'text');
    assert.equal((result.content[0] as any).text, 'Timed out');
    assert.equal((result._meta as any)?.errorType, 'TimeoutError');
    assert.equal((result._meta as any)?.errorCode, 'TIMEOUT');
  });

  it('categorizes ValidationError correctly', () => {
    const error = new ValidationError('Invalid parameter');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any)?.errorType, 'ValidationError');
    assert.equal((result._meta as any)?.errorCode, 'VALIDATION_ERROR');
  });

  it('categorizes NetworkError correctly', () => {
    const error = new NetworkError('Connection refused');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any)?.errorType, 'NetworkError');
    assert.equal((result._meta as any)?.errorCode, 'NETWORK_ERROR');
  });

  it('categorizes GitHubCliError correctly', () => {
    const error = new GitHubCliError('CLI failed');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any)?.errorType, 'GitHubCliError');
    assert.equal((result._meta as any)?.errorCode, 'GH_CLI_ERROR');
  });

  it('categorizes ParsingError correctly', () => {
    const error = new ParsingError('Parse failed');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    // ParsingError extends McpError, so it's handled as McpError with specific code
    assert.equal((result._meta as any)?.errorType, 'McpError');
    assert.equal((result._meta as any)?.errorCode, 'PARSING_ERROR');
  });

  it('categorizes FormattingError correctly', () => {
    const error = new FormattingError('Invalid format');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    // FormattingError extends McpError, so it's handled as McpError with specific code
    assert.equal((result._meta as any)?.errorType, 'McpError');
    assert.equal((result._meta as any)?.errorCode, 'FORMATTING_ERROR');
  });

  it('handles generic Error', () => {
    const error = new Error('Generic error');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result.content[0] as any).text, 'Error: Generic error');
    assert.equal((result._meta as any)?.errorType, 'UnknownError');
  });

  it('handles string errors', () => {
    const result = createErrorResult('String error');

    assert.equal(result.isError, true);
    assert.equal((result.content[0] as any).text, 'Error: String error');
    assert.equal((result._meta as any)?.errorType, 'UnknownError');
  });
});

describe('isTerminalError', () => {
  it('ValidationError is terminal', () => {
    const error = new ValidationError('Bad input');
    assert.equal(isTerminalError(error), true);
  });

  it('FormattingError is not terminal (generic McpError behavior)', () => {
    const error = new FormattingError('Invalid format');
    // FormattingError extends McpError but isn't explicitly terminal like ValidationError
    assert.equal(isTerminalError(error), false);
  });

  it('TimeoutError is not terminal (may be retryable)', () => {
    const error = new TimeoutError('Timed out');
    assert.equal(isTerminalError(error), false);
  });

  it('NetworkError is not terminal (may be retryable)', () => {
    const error = new NetworkError('Connection failed');
    assert.equal(isTerminalError(error), false);
  });

  it('ParsingError is not terminal (may be retryable)', () => {
    const error = new ParsingError('Parse failed');
    assert.equal(isTerminalError(error), false);
  });

  it('Generic error is not terminal', () => {
    const error = new Error('Generic error');
    assert.equal(isTerminalError(error), false);
  });
});
