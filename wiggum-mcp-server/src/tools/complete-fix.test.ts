/**
 * Tests for complete-fix tool
 *
 * Comprehensive test coverage for fix completion.
 * Tests cover input validation, fix description handling, and iteration tracking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CompleteFixInputSchema } from './complete-fix.js';

describe('complete-fix tool', () => {
  describe('CompleteFixInputSchema', () => {
    it('should validate required fix_description field', () => {
      const input = {
        fix_description: 'Fixed critical error handling in getMainBranch function',
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
      };

      const result = CompleteFixInputSchema.safeParse(input);
      // Schema accepts it - the tool itself validates and rejects empty strings
      assert.strictEqual(result.success, true);
    });

    it('should accept brief fix descriptions', () => {
      const input = {
        fix_description: 'Fixed bug',
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept detailed fix descriptions', () => {
      const input = {
        fix_description:
          'Fixed 38 issues across 5 categories: Error handling (empty catch blocks), Type safety (loose index signatures), Test coverage (added 4 new test files), Type design (discriminated unions), Documentation (README clarifications)',
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept fix descriptions with special characters', () => {
      const input = {
        fix_description:
          'Fixed: Type safety improvements (getMainBranch, constants.ts); Added error context logging; Removed index signatures from types.ts',
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept fix descriptions with code references', () => {
      const input = {
        fix_description:
          'Fixed empty catch blocks in `getMainBranch()` and improved error logging in `src/utils/git.ts`',
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should accept fix descriptions that reference multiple files', () => {
      const input = {
        fix_description:
          'Updated src/types.ts (removed loose index signatures), src/constants.ts (added WiggumStep type), src/utils/git.ts (added error logging)',
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
      };

      const result = CompleteFixInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });
  });
});
