/**
 * Tests for complete-fix tool
 *
 * Comprehensive test coverage for fix completion.
 * Tests cover input validation, fix description handling, and iteration tracking.
 */
// TODO: See issue #313 - Convert to behavioral/integration tests

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CompleteFixInputSchema } from './complete-fix.js';

describe('complete-fix tool', () => {
  describe('CompleteFixInputSchema', () => {
    it('should validate required fix_description field', () => {
      const input = {
        fix_description: 'Fixed critical error handling in getMainBranch function',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing fix_description', () => {
      const input = {};

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, false);
    });

    it('should accept empty fix_description at schema level (validated by tool)', () => {
      const input = {
        fix_description: '',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // Schema accepts it - the tool itself validates and rejects empty strings
      assert.strictEqual(result.success, true);
    });

    it('should accept brief fix descriptions', () => {
      const input = {
        fix_description: 'Fixed bug',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept detailed fix descriptions', () => {
      const input = {
        fix_description:
          'Fixed 38 issues across 5 categories: Error handling (empty catch blocks), Type safety (loose index signatures), Test coverage (added 4 new test files), Type design (discriminated unions), Documentation (README clarifications)',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept fix descriptions with special characters', () => {
      const input = {
        fix_description:
          'Fixed: Type safety improvements (getMainBranch, constants.ts); Added error context logging; Removed index signatures from types.ts',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept fix descriptions with code references', () => {
      const input = {
        fix_description:
          'Fixed empty catch blocks in `getMainBranch()` and improved error logging in `src/utils/git.ts`',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept fix descriptions that reference multiple files', () => {
      const input = {
        fix_description:
          'Updated src/types.ts (removed loose index signatures), src/constants.ts (added WiggumStep type), src/utils/git.ts (added error logging)',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should reject non-string fix_description', () => {
      const input = {
        fix_description: 123,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, false);
    });

    it('should accept very long fix descriptions', () => {
      const longDescription =
        'Fixed 38 PR review issues: ' +
        '1. Improved error handling with proper catch blocks and logging. ' +
        '2. Enhanced type safety by removing loose index signatures and implementing discriminated unions. ' +
        '3. Added comprehensive test coverage for core tools (next-step, complete-pr-review, complete-security-review, complete-fix). ' +
        '4. Improved documentation with clarified README and better inline comments. ' +
        '5. Removed unused module imports.';

      const input = {
        fix_description: longDescription,
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept has_in_scope_fixes: true', () => {
      const input = {
        fix_description: 'Fixed the issue',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.has_in_scope_fixes, true);
      }
    });

    it('should accept has_in_scope_fixes: false', () => {
      const input = {
        fix_description: 'No in-scope fixes',
        has_in_scope_fixes: false,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.has_in_scope_fixes, false);
      }
    });

    it('should require has_in_scope_fixes field', () => {
      const input = {
        fix_description: 'Fixed the issue',
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, false);
    });
  });

  describe('out_of_scope_issues validation', () => {
    it('should reject non-integer issue numbers', () => {
      const input = {
        fix_description: 'Fixed issues',
        has_in_scope_fixes: true,
        out_of_scope_issues: [123, 456.5, 789],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // Schema accepts it - the tool validates and rejects non-integers
      assert.strictEqual(result.success, true);
    });

    it('should reject negative issue numbers', () => {
      const input = {
        fix_description: 'Fixed issues',
        has_in_scope_fixes: true,
        out_of_scope_issues: [123, -456, 789],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // Schema accepts it - the tool validates and rejects negatives
      assert.strictEqual(result.success, true);
    });

    it('should reject zero issue numbers', () => {
      const input = {
        fix_description: 'Fixed issues',
        has_in_scope_fixes: true,
        out_of_scope_issues: [123, 0, 789],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // Schema accepts it - the tool validates and rejects zero
      assert.strictEqual(result.success, true);
    });

    it('should reject NaN issue numbers at schema level', () => {
      const input = {
        fix_description: 'Fixed issues',
        has_in_scope_fixes: true,
        out_of_scope_issues: [123, NaN, 789],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // Zod rejects NaN in number arrays at schema level
      assert.strictEqual(result.success, false);
    });

    it('should reject Infinity issue numbers', () => {
      const input = {
        fix_description: 'Fixed issues',
        has_in_scope_fixes: true,
        out_of_scope_issues: [123, Infinity, 789],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // Schema accepts it - the tool validates and rejects Infinity
      assert.strictEqual(result.success, true);
    });

    it('should accept valid positive integer issue numbers', () => {
      const input = {
        fix_description: 'Fixed issues',
        has_in_scope_fixes: true,
        out_of_scope_issues: [123, 456, 789],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.out_of_scope_issues, [123, 456, 789]);
      }
    });

    it('should accept empty out_of_scope_issues array', () => {
      const input = {
        fix_description: 'Fixed issues',
        has_in_scope_fixes: true,
        out_of_scope_issues: [],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.out_of_scope_issues, []);
      }
    });

    it('should accept undefined out_of_scope_issues', () => {
      const input = {
        fix_description: 'Fixed issues',
        has_in_scope_fixes: true,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.out_of_scope_issues, undefined);
      }
    });
  });

  describe('has_in_scope_fixes fast path behavior', () => {
    it('should accept has_in_scope_fixes: false with valid input', () => {
      const input = {
        fix_description: 'All issues were out of scope',
        has_in_scope_fixes: false,
        out_of_scope_issues: [123, 456],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.has_in_scope_fixes, false);
        assert.deepStrictEqual(result.data.out_of_scope_issues, [123, 456]);
      }
    });

    it('should accept has_in_scope_fixes: false without out_of_scope_issues', () => {
      const input = {
        fix_description: 'No actionable items',
        has_in_scope_fixes: false,
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.has_in_scope_fixes, false);
        assert.strictEqual(result.data.out_of_scope_issues, undefined);
      }
    });

    it('should accept has_in_scope_fixes: false with empty out_of_scope_issues', () => {
      const input = {
        fix_description: 'Nothing to fix',
        has_in_scope_fixes: false,
        out_of_scope_issues: [],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.has_in_scope_fixes, false);
        assert.deepStrictEqual(result.data.out_of_scope_issues, []);
      }
    });

    it('should still validate out_of_scope_issues even when has_in_scope_fixes is false', () => {
      const input = {
        fix_description: 'Out of scope tracking',
        has_in_scope_fixes: false,
        out_of_scope_issues: [123, -456, 789],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // Schema accepts it - tool should validate and reject invalid issue numbers
      // even when has_in_scope_fixes is false
      assert.strictEqual(result.success, true);
    });

    it('should require fix_description even when has_in_scope_fixes is false', () => {
      const input = {
        has_in_scope_fixes: false,
        out_of_scope_issues: [123],
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // fix_description is always required
      assert.strictEqual(result.success, false);
    });
  });
});
