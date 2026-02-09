/**
 * Tests for Error ID constants
 *
 * These tests verify the integrity and correctness of error ID constants
 * used for Sentry error tracking and grouping.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ErrorIds, type ErrorId } from './errorIds.js';

describe('ErrorIds constants', () => {
  it('should export all error ID constants with correct values', () => {
    assert.strictEqual(ErrorIds.GIT_COMMAND_FAILED, 'GIT_COMMAND_FAILED');
    assert.strictEqual(ErrorIds.GIT_NOT_A_REPOSITORY, 'GIT_NOT_A_REPOSITORY');
    assert.strictEqual(ErrorIds.GIT_VALIDATION_ERROR, 'GIT_VALIDATION_ERROR');
    assert.strictEqual(ErrorIds.GIT_NO_MAIN_BRANCH, 'GIT_NO_MAIN_BRANCH');
  });

  it('should have unique values for all constants', () => {
    const values = Object.values(ErrorIds);
    const uniqueValues = new Set(values);
    assert.strictEqual(
      values.length,
      uniqueValues.size,
      'All ErrorIds should have unique values to ensure proper error grouping in Sentry'
    );
  });

  it('should have exactly 4 error IDs defined', () => {
    const keys = Object.keys(ErrorIds);
    assert.strictEqual(keys.length, 4, 'Expected 4 error ID constants');
  });

  it('should have all constant names match their values', () => {
    // Verify that constant name matches its string value (SCREAMING_SNAKE_CASE)
    Object.entries(ErrorIds).forEach(([key, value]) => {
      assert.strictEqual(
        key,
        value,
        `Constant name ${key} should match its value ${value}`
      );
    });
  });

  it('should be usable as const assertion', () => {
    // Verify type narrowing works correctly
    const errorId: ErrorId = ErrorIds.GIT_COMMAND_FAILED;
    assert.strictEqual(typeof errorId, 'string');
    assert.strictEqual(errorId, 'GIT_COMMAND_FAILED');
  });
});

describe('ErrorId type', () => {
  it('should accept all defined ErrorIds constant values', () => {
    const testErrorId = (id: ErrorId) => {
      assert.strictEqual(typeof id, 'string');
    };

    testErrorId(ErrorIds.GIT_COMMAND_FAILED);
    testErrorId(ErrorIds.GIT_NOT_A_REPOSITORY);
    testErrorId(ErrorIds.GIT_VALIDATION_ERROR);
    testErrorId(ErrorIds.GIT_NO_MAIN_BRANCH);
  });

  it('should work as discriminated union type', () => {
    // Verify the ErrorId type is properly derived
    type ErrorIdKeys = keyof typeof ErrorIds;
    const keys: ErrorIdKeys[] = [
      'GIT_COMMAND_FAILED',
      'GIT_NOT_A_REPOSITORY',
      'GIT_VALIDATION_ERROR',
      'GIT_NO_MAIN_BRANCH',
    ];

    assert.strictEqual(keys.length, 4);
  });
});

describe('ErrorIds usage patterns', () => {
  it('should be usable in switch statements', () => {
    const testSwitch = (errorId: ErrorId): string => {
      switch (errorId) {
        case ErrorIds.GIT_COMMAND_FAILED:
          return 'command failed';
        case ErrorIds.GIT_NOT_A_REPOSITORY:
          return 'not a repo';
        case ErrorIds.GIT_VALIDATION_ERROR:
          return 'validation error';
        case ErrorIds.GIT_NO_MAIN_BRANCH:
          return 'no main branch';
        default:
          // TypeScript should ensure this is unreachable
          return 'unknown';
      }
    };

    assert.strictEqual(testSwitch(ErrorIds.GIT_COMMAND_FAILED), 'command failed');
    assert.strictEqual(testSwitch(ErrorIds.GIT_NOT_A_REPOSITORY), 'not a repo');
    assert.strictEqual(testSwitch(ErrorIds.GIT_VALIDATION_ERROR), 'validation error');
    assert.strictEqual(testSwitch(ErrorIds.GIT_NO_MAIN_BRANCH), 'no main branch');
  });

  it('should be usable in equality checks', () => {
    const errorId: ErrorId = ErrorIds.GIT_VALIDATION_ERROR;

    assert.strictEqual(errorId === ErrorIds.GIT_VALIDATION_ERROR, true);
    // @ts-expect-error - Testing inequality check between different error types
    assert.strictEqual(errorId === ErrorIds.GIT_COMMAND_FAILED, false);
  });

  it('should be usable in object property access', () => {
    const errorHandlers: Record<ErrorId, () => string> = {
      [ErrorIds.GIT_COMMAND_FAILED]: () => 'handle command failed',
      [ErrorIds.GIT_NOT_A_REPOSITORY]: () => 'handle not a repo',
      [ErrorIds.GIT_VALIDATION_ERROR]: () => 'handle validation error',
      [ErrorIds.GIT_NO_MAIN_BRANCH]: () => 'handle no main branch',
    };

    assert.strictEqual(errorHandlers[ErrorIds.GIT_COMMAND_FAILED](), 'handle command failed');
    assert.strictEqual(
      errorHandlers[ErrorIds.GIT_VALIDATION_ERROR](),
      'handle validation error'
    );
  });
});

describe('ErrorIds constant immutability', () => {
  it('should be defined as const object', () => {
    // Verify the object is read-only (TypeScript enforces this at compile time)
    // At runtime, we can at least verify the values exist and are strings
    assert.strictEqual(typeof ErrorIds.GIT_COMMAND_FAILED, 'string');
    assert.strictEqual(typeof ErrorIds.GIT_NOT_A_REPOSITORY, 'string');
    assert.strictEqual(typeof ErrorIds.GIT_VALIDATION_ERROR, 'string');
    assert.strictEqual(typeof ErrorIds.GIT_NO_MAIN_BRANCH, 'string');
  });

  it('should prevent TypeScript from allowing new properties', () => {
    // TypeScript enforces const assertion at compile time
    // This test documents that the object is type-safe (read-only)
    // @ts-expect-error - ErrorIds is const, cannot add new properties
    const _test = ErrorIds.NEW_ERROR_ID;

    // Runtime: const assertion doesn't freeze the object, but TypeScript prevents modification
    assert.strictEqual(typeof ErrorIds, 'object');
  });
});
