/**
 * Tests for list-issues tool
 *
 * Test coverage for the issue listing tool that returns minimal references.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ListIssuesInputSchema } from './list-issues.js';

describe('list-issues tool', () => {
  describe('ListIssuesInputSchema', () => {
    describe('valid inputs', () => {
      it('should validate with scope="in-scope"', () => {
        const input = { scope: 'in-scope' as const };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.scope, 'in-scope');
        }
      });

      it('should validate with scope="out-of-scope"', () => {
        const input = { scope: 'out-of-scope' as const };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.scope, 'out-of-scope');
        }
      });

      it('should validate with scope="all"', () => {
        const input = { scope: 'all' as const };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.scope, 'all');
        }
      });

      it('should default scope to "all" when omitted', () => {
        const input = {};
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.scope, 'all');
        }
      });
    });

    describe('invalid inputs', () => {
      it('should reject invalid scope value', () => {
        const input = { scope: 'invalid-scope' };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject numeric scope', () => {
        const input = { scope: 123 };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject boolean scope', () => {
        const input = { scope: true };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });
    });
  });

  // NOTE: Full behavioral testing of manifest file reading, issue ID generation,
  // and count calculation requires integration tests with filesystem mocks.
  // The core logic tested here:
  // 1. Input validation ensures only valid scope values
  // 2. Scope defaults to "all" when omitted
  // 3. Invalid scope values are rejected
});
