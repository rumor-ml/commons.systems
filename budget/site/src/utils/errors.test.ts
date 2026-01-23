/**
 * Tests for Budget error utilities
 */

import { describe, it, expect } from 'vitest';
import { BudgetError, isBudgetError, formatBudgetError } from './errors';

describe('BudgetError', () => {
  it('should create error with code and message', () => {
    const error = new BudgetError('Test error', 'DATA_VALIDATION');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BudgetError);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('DATA_VALIDATION');
    expect(error.name).toBe('BudgetError');
  });

  it('should create error with optional context', () => {
    const context = { userId: 123, category: 'groceries' };
    const error = new BudgetError('Validation failed', 'DATA_VALIDATION', context);

    expect(error.context).toEqual(context);
  });

  it('should create error without context', () => {
    const error = new BudgetError('Simple error', 'UNEXPECTED');

    expect(error.context).toBeUndefined();
  });

  it('should support all error codes', () => {
    const codes = [
      'DATA_VALIDATION',
      'CHART_RENDER',
      'STORAGE_ACCESS',
      'HYDRATION',
      'PROPS_PARSE',
      'CALCULATION',
      'UNEXPECTED',
    ] as const;

    codes.forEach((code) => {
      const error = new BudgetError('Test', code);
      expect(error.code).toBe(code);
    });
  });
});

describe('isBudgetError', () => {
  it('should return true for BudgetError instances', () => {
    const error = new BudgetError('Test', 'DATA_VALIDATION');
    expect(isBudgetError(error)).toBe(true);
  });

  it('should return false for regular Error', () => {
    const error = new Error('Test');
    expect(isBudgetError(error)).toBe(false);
  });

  it('should return false for TypeError', () => {
    const error = new TypeError('Test');
    expect(isBudgetError(error)).toBe(false);
  });

  it('should return false for non-Error objects', () => {
    expect(isBudgetError('string')).toBe(false);
    expect(isBudgetError(123)).toBe(false);
    expect(isBudgetError(null)).toBe(false);
    expect(isBudgetError(undefined)).toBe(false);
    expect(isBudgetError({})).toBe(false);
  });
});

describe('formatBudgetError', () => {
  it('should format BudgetError with code', () => {
    const error = new BudgetError('Test error', 'DATA_VALIDATION');
    const formatted = formatBudgetError(error);

    expect(formatted).toContain('[BudgetError]');
    expect(formatted).toContain('(DATA_VALIDATION)');
    expect(formatted).toContain('Test error');
  });

  it('should format BudgetError with context', () => {
    const error = new BudgetError('Validation failed', 'DATA_VALIDATION', {
      field: 'amount',
      value: -100,
    });
    const formatted = formatBudgetError(error);

    expect(formatted).toContain('Context:');
    expect(formatted).toContain('"field": "amount"');
    expect(formatted).toContain('"value": -100');
  });

  it('should exclude stack trace by default', () => {
    const error = new BudgetError('Test', 'UNEXPECTED');
    const formatted = formatBudgetError(error);

    expect(formatted).not.toContain('Stack:');
  });

  it('should include stack trace when requested', () => {
    const error = new BudgetError('Test', 'UNEXPECTED');
    const formatted = formatBudgetError(error, true);

    expect(formatted).toContain('Stack:');
    expect(formatted).toContain('BudgetError');
  });

  it('should format regular Error instances', () => {
    const error = new Error('Generic error');
    const formatted = formatBudgetError(error);

    expect(formatted).toContain('[Error]');
    expect(formatted).toContain('Generic error');
  });

  it('should format TypeError instances', () => {
    const error = new TypeError('Type error');
    const formatted = formatBudgetError(error);

    expect(formatted).toContain('[TypeError]');
    expect(formatted).toContain('Type error');
  });

  it('should format non-Error values as strings', () => {
    expect(formatBudgetError('string error')).toBe('string error');
    expect(formatBudgetError(123)).toBe('123');
    expect(formatBudgetError(null)).toBe('null');
    expect(formatBudgetError(undefined)).toBe('undefined');
  });

  it('should handle Error with stack trace', () => {
    const error = new Error('Test error');
    const formatted = formatBudgetError(error, true);

    expect(formatted).toContain('[Error]');
    expect(formatted).toContain('Test error');
    expect(formatted).toContain('Stack:');
  });

  it('should handle BudgetError without context', () => {
    const error = new BudgetError('No context', 'CALCULATION');
    const formatted = formatBudgetError(error);

    expect(formatted).not.toContain('Context:');
    expect(formatted).toBe('[BudgetError] (CALCULATION) No context');
  });

  it('should handle BudgetError with empty context', () => {
    const error = new BudgetError('Empty context', 'CALCULATION', {});
    const formatted = formatBudgetError(error);

    expect(formatted).not.toContain('Context:');
  });
});
