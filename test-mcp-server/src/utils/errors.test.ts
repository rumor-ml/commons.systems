/**
 * Tests for error handling utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  McpError,
  ScriptExecutionError,
  TimeoutError,
  ValidationError,
  InfrastructureError,
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

  it('should create McpError without code', () => {
    const error = new McpError('Test error');
    assert.strictEqual(error.message, 'Test error');
    assert.strictEqual(error.code, undefined);
    assert.strictEqual(error.name, 'McpError');
  });

  it('should create ScriptExecutionError', () => {
    const error = new ScriptExecutionError('Script failed', 1, 'stderr output');
    assert.strictEqual(error.message, 'Script failed');
    assert.strictEqual(error.code, 'SCRIPT_EXECUTION_ERROR');
    assert.strictEqual(error.exitCode, 1);
    assert.strictEqual(error.stderr, 'stderr output');
    assert.strictEqual(error.name, 'ScriptExecutionError');
  });

  it('should create ScriptExecutionError without exit code and stderr', () => {
    const error = new ScriptExecutionError('Script failed');
    assert.strictEqual(error.message, 'Script failed');
    assert.strictEqual(error.code, 'SCRIPT_EXECUTION_ERROR');
    assert.strictEqual(error.exitCode, undefined);
    assert.strictEqual(error.stderr, undefined);
    assert.strictEqual(error.name, 'ScriptExecutionError');
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

  it('should create InfrastructureError', () => {
    const error = new InfrastructureError('Infrastructure failed');
    assert.strictEqual(error.message, 'Infrastructure failed');
    assert.strictEqual(error.code, 'INFRASTRUCTURE_ERROR');
    assert.strictEqual(error.name, 'InfrastructureError');
  });
});

describe('createErrorResult', () => {
  it('should create error result for TimeoutError', () => {
    const error = new TimeoutError('Timed out');
    const result = createErrorResult(error);

    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.content[0].type, 'text');
    assert.strictEqual(result.content[0].text, 'Error: Timed out');
    assert.strictEqual((result._meta as any)?.errorType, 'TimeoutError');
    assert.strictEqual((result._meta as any)?.errorCode, 'TIMEOUT');
  });

  it('should create error result for ValidationError', () => {
    const error = new ValidationError('Invalid');
    const result = createErrorResult(error);

    assert.strictEqual((result._meta as any)?.errorType, 'ValidationError');
    assert.strictEqual((result._meta as any)?.errorCode, 'VALIDATION_ERROR');
  });

  it('should create error result for ScriptExecutionError', () => {
    const error = new ScriptExecutionError('Script failed');
    const result = createErrorResult(error);

    assert.strictEqual((result._meta as any)?.errorType, 'ScriptExecutionError');
    assert.strictEqual((result._meta as any)?.errorCode, 'SCRIPT_EXECUTION_ERROR');
  });

  it('should create error result for InfrastructureError', () => {
    const error = new InfrastructureError('Infrastructure failed');
    const result = createErrorResult(error);

    assert.strictEqual((result._meta as any)?.errorType, 'InfrastructureError');
    assert.strictEqual((result._meta as any)?.errorCode, 'INFRASTRUCTURE_ERROR');
  });

  it('should create error result for McpError', () => {
    const error = new McpError('MCP error', 'CUSTOM_CODE');
    const result = createErrorResult(error);

    assert.strictEqual((result._meta as any)?.errorType, 'McpError');
    assert.strictEqual((result._meta as any)?.errorCode, 'CUSTOM_CODE');
  });

  it('should create error result for generic Error', () => {
    const error = new Error('Generic error');
    const result = createErrorResult(error);

    assert.strictEqual(result.content[0].text, 'Error: Generic error');
    assert.strictEqual((result._meta as any)?.errorType, 'UnknownError');
  });

  it('should create error result for string error', () => {
    const result = createErrorResult('String error');

    assert.strictEqual(result.content[0].text, 'Error: String error');
    assert.strictEqual((result._meta as any)?.errorType, 'UnknownError');
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

  it('should return true for ScriptExecutionError with non-zero exit code', () => {
    const error = new ScriptExecutionError('Script failed', 1);
    assert.strictEqual(isTerminalError(error), true);
  });

  it('should return false for ScriptExecutionError with zero exit code', () => {
    const error = new ScriptExecutionError('Script succeeded', 0);
    assert.strictEqual(isTerminalError(error), false);
  });

  it('should return false for ScriptExecutionError without exit code', () => {
    const error = new ScriptExecutionError('Script failed');
    assert.strictEqual(isTerminalError(error), false);
  });

  it('should return false for TimeoutError', () => {
    const error = new TimeoutError('Timed out');
    assert.strictEqual(isTerminalError(error), false);
  });

  it('should return false for InfrastructureError', () => {
    const error = new InfrastructureError('Infrastructure failed');
    assert.strictEqual(isTerminalError(error), false);
  });

  it('should return false for generic Error', () => {
    const error = new Error('Generic');
    assert.strictEqual(isTerminalError(error), false);
  });
});
