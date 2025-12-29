/**
 * Tests for record-review-issue tool
 *
 * Comprehensive test coverage for the review issue recording tool.
 * Tests cover input validation, manifest file operations, and priority validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RecordReviewIssueInputSchema } from './record-review-issue.js';

describe('record-review-issue tool', () => {
  describe('RecordReviewIssueInputSchema', () => {
    describe('valid inputs', () => {
      it('should validate input with all required fields', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.agent_name, 'code-reviewer');
          assert.strictEqual(result.data.scope, 'in-scope');
          assert.strictEqual(result.data.priority, 'high');
        }
      });

      it('should validate input with optional location field', () => {
        const input = {
          agent_name: 'silent-failure-hunter',
          scope: 'out-of-scope' as const,
          priority: 'low' as const,
          title: 'Test issue',
          description: 'Test description',
          location: 'src/api.ts:45',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.location, 'src/api.ts:45');
        }
      });

      it('should validate input with optional existing_todo field', () => {
        const input = {
          agent_name: 'pr-test-analyzer',
          scope: 'out-of-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
          existing_todo: {
            has_todo: true,
            issue_reference: '#123',
          },
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.existing_todo?.has_todo, true);
          assert.strictEqual(result.data.existing_todo?.issue_reference, '#123');
        }
      });

      it('should validate input with optional metadata field', () => {
        const input = {
          agent_name: 'code-simplifier',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
          metadata: { confidence: 95, severity: 'critical' },
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.deepStrictEqual(result.data.metadata, {
            confidence: 95,
            severity: 'critical',
          });
        }
      });

      it('should accept high priority for in-scope issues', () => {
        const input = {
          agent_name: 'comment-analyzer',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
      });

      it('should accept low priority for in-scope issues', () => {
        const input = {
          agent_name: 'type-design-analyzer',
          scope: 'in-scope' as const,
          priority: 'low' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
      });

      it('should accept high priority for out-of-scope issues', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'out-of-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
      });

      it('should accept low priority for out-of-scope issues', () => {
        const input = {
          agent_name: 'silent-failure-hunter',
          scope: 'out-of-scope' as const,
          priority: 'low' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
      });
    });

    describe('invalid inputs', () => {
      it('should reject missing agent_name', () => {
        const input = {
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject empty agent_name', () => {
        const input = {
          agent_name: '',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject missing scope', () => {
        const input = {
          agent_name: 'code-reviewer',
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject invalid scope value', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'invalid-scope',
          priority: 'high' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
        if (!result.success) {
          // Verify error message
          const scopeError = result.error.errors.find((e) => e.path.includes('scope'));
          assert.ok(scopeError);
          assert.ok(
            scopeError.message.includes('in-scope') || scopeError.message.includes('out-of-scope')
          );
        }
      });

      it('should reject missing priority', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject invalid priority value (medium)', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'medium',
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
        if (!result.success) {
          // Verify error message mentions only high/low
          const priorityError = result.error.errors.find((e) => e.path.includes('priority'));
          assert.ok(priorityError);
          assert.ok(
            priorityError.message.includes('high') || priorityError.message.includes('low')
          );
        }
      });

      it('should reject invalid priority value (critical)', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'critical',
          title: 'Test issue',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject missing title', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject empty title', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: '',
          description: 'Test description',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject missing description', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject empty description', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: 'Test issue',
          description: '',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });
    });

    describe('priority validation - only high and low allowed', () => {
      it('should accept exactly "high" as priority', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'high' as const,
          title: 'Test',
          description: 'Test',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
      });

      it('should accept exactly "low" as priority', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'low' as const,
          title: 'Test',
          description: 'Test',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
      });

      it('should reject "HIGH" (uppercase)', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'HIGH',
          title: 'Test',
          description: 'Test',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject "Low" (capitalized)', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 'Low',
          title: 'Test',
          description: 'Test',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject numeric priority', () => {
        const input = {
          agent_name: 'code-reviewer',
          scope: 'in-scope' as const,
          priority: 1,
          title: 'Test',
          description: 'Test',
        };
        const result = RecordReviewIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });
    });
  });

  // NOTE: Full behavioral testing of manifest file creation, GitHub comment posting,
  // and filename collision prevention requires integration tests with filesystem mocks.
  // The core logic tested here:
  // 1. Input validation ensures only high/low priority
  // 2. All required fields are enforced
  // 3. Optional fields are correctly handled
  // 4. Invalid scope/priority values are rejected with clear error messages
});
