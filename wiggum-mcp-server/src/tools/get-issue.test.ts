/**
 * Tests for get-issue tool
 *
 * Test coverage for the issue details retrieval tool.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GetIssueInputSchema } from './get-issue.js';

describe('get-issue tool', () => {
  describe('GetIssueInputSchema', () => {
    describe('valid inputs', () => {
      it('should validate with valid issue ID', () => {
        const input = { id: 'code-reviewer-in-scope-0' };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'code-reviewer-in-scope-0');
        }
      });

      it('should validate with out-of-scope ID', () => {
        const input = { id: 'silent-failure-hunter-out-of-scope-5' };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'silent-failure-hunter-out-of-scope-5');
        }
      });

      it('should validate with hyphenated agent name', () => {
        const input = { id: 'pr-test-analyzer-in-scope-2' };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'pr-test-analyzer-in-scope-2');
        }
      });
    });

    describe('invalid inputs', () => {
      it('should reject missing id', () => {
        const input = {};
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject empty id', () => {
        const input = { id: '' };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject numeric id', () => {
        const input = { id: 123 };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject boolean id', () => {
        const input = { id: true };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });
    });
  });

  // NOTE: Full behavioral testing of ID parsing, manifest file reading,
  // and issue retrieval requires integration tests with filesystem mocks.
  // The core logic tested here:
  // 1. Input validation ensures id is a non-empty string
  // 2. Various ID formats are accepted
  // 3. Invalid id values are rejected
});
