import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createErrorResult,
  createSuccessResult,
  createErrorResultFromError,
} from './result-builders.js';
import {
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  McpError,
} from './errors.js';

describe('createErrorResult', () => {
  it('creates error result for TimeoutError', () => {
    const error = new TimeoutError('Operation timed out');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'Error: Operation timed out');
    assert.equal((result._meta as any).errorType, 'TimeoutError');
    assert.equal((result._meta as any).errorCode, 'TIMEOUT');
  });

  it('creates error result for ValidationError', () => {
    const error = new ValidationError('Invalid input');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).errorType, 'ValidationError');
    assert.equal((result._meta as any).errorCode, 'VALIDATION_ERROR');
  });

  it('creates error result for NetworkError', () => {
    const error = new NetworkError('Connection failed');
    const result = createErrorResult(error);

    assert.equal((result._meta as any).errorType, 'NetworkError');
    assert.equal((result._meta as any).errorCode, 'NETWORK_ERROR');
  });

  it('creates error result for GitHubCliError', () => {
    const error = new GitHubCliError('gh failed', 1, 'stderr output');
    const result = createErrorResult(error);

    assert.equal((result._meta as any).errorType, 'GitHubCliError');
    assert.equal((result._meta as any).errorCode, 'GH_CLI_ERROR');
  });

  it('creates error result for generic McpError', () => {
    const error = new McpError('Generic error', 'PARSING_ERROR');
    const result = createErrorResult(error);

    assert.equal((result._meta as any).errorType, 'McpError');
    assert.equal((result._meta as any).errorCode, 'PARSING_ERROR');
  });

  it('handles generic Error instances', () => {
    const error = new Error('Generic error');
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any).errorType, 'UnknownError');
  });

  it('handles string errors', () => {
    const result = createErrorResult('String error');

    assert.equal(result.content[0].text, 'Error: String error');
  });
});

describe('createSuccessResult', () => {
  it('creates success result with text only', () => {
    const result = createSuccessResult('Success');

    assert.equal(result.isError, false);
    assert.deepEqual(result.content, [{ type: 'text', text: 'Success' }]);
  });

  it('creates success result with metadata', () => {
    const result = createSuccessResult('Success', { key: 'value' });

    assert.equal(result.isError, false);
    assert.equal((result._meta as any).key, 'value');
  });
});

describe('createErrorResultFromError', () => {
  it('returns ToolError for TimeoutError', () => {
    const error = new TimeoutError('Timeout');
    const result = createErrorResultFromError(error);

    assert.notEqual(result, null);
    assert.equal(result!._meta.errorType, 'TimeoutError');
    assert.equal(result!._meta.errorCode, 'TIMEOUT');
  });

  it('returns ToolError for GitHubCliError', () => {
    const error = new GitHubCliError('gh failed', 1, 'stderr');
    const result = createErrorResultFromError(error);

    assert.notEqual(result, null);
    assert.equal(result!._meta.errorType, 'GitHubCliError');
    assert.equal(result!._meta.errorCode, 'GH_CLI_ERROR');
  });

  it('returns ToolError for generic McpError', () => {
    const error = new McpError('Error', 'PARSING_ERROR');
    const result = createErrorResultFromError(error);

    assert.notEqual(result, null);
    assert.equal(result!._meta.errorCode, 'PARSING_ERROR');
  });

  it('returns generic ToolError for non-McpError with fallback (default)', () => {
    const error = new Error('Generic');
    const result = createErrorResultFromError(error);

    // With fallbackToGeneric=true (default), returns ToolError
    assert.notEqual(result, null);
    assert.equal(result!._meta.errorType, 'Error');
    assert.equal(result!._meta.errorCode, 'UNKNOWN_ERROR');
  });

  it('returns null for non-McpError without fallback', () => {
    const error = new Error('Generic');
    const result = createErrorResultFromError(error, false);

    // With fallbackToGeneric=false, returns null
    assert.equal(result, null);
  });
});
