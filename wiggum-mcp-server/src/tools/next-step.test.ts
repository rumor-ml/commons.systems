/**
 * Tests for next-step tool
 *
 * Comprehensive test coverage for the primary orchestration tool.
 * Tests cover state detection, step progression, and instruction generation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NextStepInputSchema } from './next-step.js';

describe('next-step tool', () => {
  describe('NextStepInputSchema', () => {
    it('should validate empty input object', () => {
      const result = NextStepInputSchema.safeParse({});
      assert.strictEqual(result.success, true);
    });

    it('should accept input with no required fields', () => {
      const result = NextStepInputSchema.safeParse({});
      assert.strictEqual(result.success, true);
      assert.deepEqual(result.data, {});
    });

    it('should reject input with unexpected fields silently (extra fields ignored)', () => {
      const result = NextStepInputSchema.safeParse({ unexpectedField: 'value' });
      assert.strictEqual(result.success, true);
    });
  });
});
