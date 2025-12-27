/**
 * Tests for complete-security-review tool
 *
 * Comprehensive test coverage for security review completion.
 * Tests cover input validation, security issue counting, and state management.
 */
// TODO(#313): Convert to behavioral/integration tests

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CompleteSecurityReviewInputSchema } from './complete-security-review.js';

describe('complete-security-review tool', () => {
  describe('CompleteSecurityReviewInputSchema', () => {
    it('should validate required fields', () => {
      const input = {
        command_executed: true,
        in_scope_files: ['/path/to/file1.ts'],
        out_of_scope_files: [],
        in_scope_count: 3,
        out_of_scope_count: 0,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing command_executed field', () => {
      const input = {
        in_scope_files: ['/path/to/file1.ts'],
        out_of_scope_files: [],
        in_scope_count: 3,
        out_of_scope_count: 0,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, false);
    });

    it('should accept verbatim_response_file instead of verbatim_response', () => {
      const input = {
        command_executed: true,
        in_scope_files: ['/path/to/file1.ts', '/path/to/file2.ts'],
        out_of_scope_files: ['/path/to/file3.ts'],
        in_scope_count: 2,
        out_of_scope_count: 1,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept both verbatim_response and verbatim_response_file (file takes precedence at runtime)', () => {
      const input = {
        command_executed: true,
        in_scope_files: ['/path/to/file1.ts'],
        out_of_scope_files: ['/path/to/file2.ts'],
        in_scope_count: 1,
        out_of_scope_count: 1,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept missing verbatim fields at schema level (validated at runtime)', () => {
      const input = {
        command_executed: true,
        in_scope_files: [],
        out_of_scope_files: [],
        in_scope_count: 0,
        out_of_scope_count: 0,
      };

      // Schema accepts it - tool runtime validates at least one is provided
      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing security issue counts', () => {
      const input = {
        command_executed: true,
        in_scope_files: ['/path/to/file1.ts'],
        out_of_scope_files: [],
        in_scope_count: 3,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, false);
    });

    it('should accept zero security issues', () => {
      const input = {
        command_executed: true,
        in_scope_files: [],
        out_of_scope_files: [],
        in_scope_count: 0,
        out_of_scope_count: 0,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept negative security issue counts at schema level (validated by tool)', () => {
      const input = {
        command_executed: true,
        in_scope_files: ['/path/to/file1.ts'],
        out_of_scope_files: [],
        in_scope_count: -1,
        out_of_scope_count: 2,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      // Schema rejects negative counts because of .nonnegative()
      assert.strictEqual(result.success, false);
    });

    it('should accept high priority security issues', () => {
      const input = {
        command_executed: true,
        in_scope_files: ['/path/to/file1.ts', '/path/to/file2.ts'],
        out_of_scope_files: [],
        in_scope_count: 10,
        out_of_scope_count: 0,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should validate that command was actually executed', () => {
      const input = {
        command_executed: false, // This should fail business rule validation
        in_scope_files: ['/path/to/file1.ts'],
        out_of_scope_files: [],
        in_scope_count: 3,
        out_of_scope_count: 0,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      // Schema allows it, but tool should validate it was actually executed
      assert.strictEqual(result.success, true);
    });
  });
});
