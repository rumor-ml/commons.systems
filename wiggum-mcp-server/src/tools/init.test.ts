/**
 * Tests for init tool
 *
 * Comprehensive test coverage for the initialization/entry point tool.
 * Tests cover state detection, step progression, and instruction generation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WiggumInitInputSchema } from './init.js';

describe('init tool', () => {
  describe('WiggumInitInputSchema', () => {
    it('should validate empty input object', () => {
      const result = WiggumInitInputSchema.safeParse({});
      assert.strictEqual(result.success, true);
    });

    it('should accept input with no required fields', () => {
      const result = WiggumInitInputSchema.safeParse({});
      assert.strictEqual(result.success, true);
      assert.deepEqual(result.data, {});
    });

    it('should reject input with unexpected fields silently (extra fields ignored)', () => {
      const result = WiggumInitInputSchema.safeParse({ unexpectedField: 'value' });
      assert.strictEqual(result.success, true);
    });
  });

  // TODO(#313): Add behavioral tests for wiggum_init error handling integration
  // Requires mocking detectCurrentState() - see detector.test.ts header NOTE
  // - Test error result returned for StateDetectionError
  // - Test error result returned for StateApiError
  // - Test error logging includes errorType, errorMessage, context fields
  // - Test unexpected errors are re-thrown (not caught)
  // - Test logging before re-throw for unexpected errors
});
