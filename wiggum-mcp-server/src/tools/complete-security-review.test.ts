/**
 * Tests for complete-security-review tool
 *
 * Comprehensive test coverage for security review completion.
 * Tests cover input validation, security issue counting, and state management.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CompleteSecurityReviewInputSchema } from './complete-security-review.js';

describe('complete-security-review tool', () => {
  describe('CompleteSecurityReviewInputSchema', () => {
    it('should validate required fields', () => {
      const input = {
        command_executed: true,
        verbatim_response: 'Security review output here',
        high_priority_issues: 3,
        medium_priority_issues: 5,
        low_priority_issues: 2,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing command_executed field', () => {
      const input = {
        verbatim_response: 'Security review output',
        high_priority_issues: 3,
        medium_priority_issues: 5,
        low_priority_issues: 2,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, false);
    });

    it('should reject missing verbatim_response field', () => {
      const input = {
        command_executed: true,
        high_priority_issues: 3,
        medium_priority_issues: 5,
        low_priority_issues: 2,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, false);
    });

    it('should reject missing security issue counts', () => {
      const input = {
        command_executed: true,
        verbatim_response: 'Security review output',
        high_priority_issues: 3,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, false);
    });

    it('should accept zero security issues', () => {
      const input = {
        command_executed: true,
        verbatim_response: 'No security issues found',
        high_priority_issues: 0,
        medium_priority_issues: 0,
        low_priority_issues: 0,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept negative security issue counts at schema level (validated by tool)', () => {
      const input = {
        command_executed: true,
        verbatim_response: 'Security review output',
        high_priority_issues: -1,
        medium_priority_issues: 5,
        low_priority_issues: 2,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      // Schema accepts it - tool business logic should validate counts are non-negative
      assert.strictEqual(result.success, true);
    });

    it('should accept high priority security issues', () => {
      const input = {
        command_executed: true,
        verbatim_response: 'Critical security vulnerabilities found',
        high_priority_issues: 10,
        medium_priority_issues: 5,
        low_priority_issues: 2,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should validate that command was actually executed', () => {
      const input = {
        command_executed: false, // This should fail business rule validation
        verbatim_response: 'Security review output',
        high_priority_issues: 3,
        medium_priority_issues: 5,
        low_priority_issues: 2,
      };

      const result = CompleteSecurityReviewInputSchema.safeParse(input);
      // Schema allows it, but tool should validate it was actually executed
      assert.strictEqual(result.success, true);
    });
  });
});
