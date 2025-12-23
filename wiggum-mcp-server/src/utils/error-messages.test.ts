/**
 * Tests for error-messages.ts utility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildValidationErrorMessage } from './error-messages.js';

describe('buildValidationErrorMessage', () => {
  it('should build message with all parts', () => {
    const message = buildValidationErrorMessage({
      problem: 'Invalid parameter',
      context: 'Received: null',
      expected: 'Non-null string',
      remediation: ['Step 1', 'Step 2'],
    });

    assert.ok(message.includes('Problem: Invalid parameter'));
    assert.ok(message.includes('Current context:'));
    assert.ok(message.includes('Received: null'));
    assert.ok(message.includes('Expected:'));
    assert.ok(message.includes('Non-null string'));
    assert.ok(message.includes('How to fix:'));
    assert.ok(message.includes('1. Step 1'));
    assert.ok(message.includes('2. Step 2'));
  });

  it('should build message with only problem', () => {
    const message = buildValidationErrorMessage({
      problem: 'Something went wrong',
    });

    assert.strictEqual(message, 'Problem: Something went wrong');
  });

  it('should build message with problem and context', () => {
    const message = buildValidationErrorMessage({
      problem: 'Invalid value',
      context: 'Got: 42',
    });

    assert.ok(message.includes('Problem: Invalid value'));
    assert.ok(message.includes('Current context:'));
    assert.ok(message.includes('Got: 42'));
    assert.ok(!message.includes('Expected:'));
    assert.ok(!message.includes('How to fix:'));
  });

  it('should handle empty remediation array', () => {
    const message = buildValidationErrorMessage({
      problem: 'Error',
      remediation: [],
    });

    assert.strictEqual(message, 'Problem: Error');
    assert.ok(!message.includes('How to fix:'));
  });

  it('should number remediation steps correctly', () => {
    const message = buildValidationErrorMessage({
      problem: 'Error',
      remediation: ['First', 'Second', 'Third'],
    });

    assert.ok(message.includes('1. First'));
    assert.ok(message.includes('2. Second'));
    assert.ok(message.includes('3. Third'));
  });
});
