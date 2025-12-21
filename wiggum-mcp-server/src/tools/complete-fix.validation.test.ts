/**
 * Validation tests for complete-fix tool
 *
 * These tests verify the runtime validation behavior that occurs BEFORE state detection.
 * Tests cover:
 * - out_of_scope_issues validation (Priority 2)
 * - fix_description validation (Priority 3)
 * - Input validation on fast-path (Priority 4)
 *
 * These tests execute the actual completeFix() validation logic by providing
 * invalid inputs and verifying the appropriate ValidationErrors are thrown.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { completeFix, type CompleteFixInput } from './complete-fix.js';
import { ValidationError } from '../utils/errors.js';

describe('complete-fix validation (Priority 2: out_of_scope_issues)', () => {
  it('should throw ValidationError for negative issue numbers', async () => {
    const input: CompleteFixInput = {
      fix_description: 'Fixed issues',
      has_in_scope_fixes: true,
      out_of_scope_issues: [123, -456, 789],
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError, 'Should be ValidationError');
        assert(err.message.includes('Invalid issue numbers'), 'Should mention invalid numbers');
        assert(err.message.includes('-456'), 'Should include the invalid number');
        assert(err.message.includes('positive integers'), 'Should explain valid format');
        return true;
      }
    );
  });

  it('should throw ValidationError for zero issue numbers', async () => {
    const input: CompleteFixInput = {
      fix_description: 'Fixed issues',
      has_in_scope_fixes: true,
      out_of_scope_issues: [123, 0, 789],
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('Invalid issue numbers'));
        assert(err.message.includes('0'));
        return true;
      }
    );
  });

  it('should throw ValidationError for non-integer issue numbers', async () => {
    const input: CompleteFixInput = {
      fix_description: 'Fixed issues',
      has_in_scope_fixes: true,
      out_of_scope_issues: [123, 456.789, 789],
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('Invalid issue numbers'));
        assert(err.message.includes('456.789'));
        return true;
      }
    );
  });

  it('should throw ValidationError for Infinity issue numbers', async () => {
    const input: CompleteFixInput = {
      fix_description: 'Fixed issues',
      has_in_scope_fixes: true,
      out_of_scope_issues: [123, Infinity, 789],
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('Invalid issue numbers'));
        assert(err.message.includes('Infinity'));
        return true;
      }
    );
  });

  it('should throw ValidationError listing all invalid issue numbers', async () => {
    const input: CompleteFixInput = {
      fix_description: 'Fixed issues',
      has_in_scope_fixes: true,
      out_of_scope_issues: [123, -1, 0, 456.5, Infinity, 789],
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        // Should list all invalid numbers
        assert(err.message.includes('-1'), 'Should include -1');
        assert(err.message.includes('0'), 'Should include 0');
        assert(err.message.includes('456.5'), 'Should include 456.5');
        assert(err.message.includes('Infinity'), 'Should include Infinity');
        return true;
      }
    );
  });

  it('should validate out_of_scope_issues even on fast-path (has_in_scope_fixes: false)', async () => {
    const input: CompleteFixInput = {
      fix_description: 'Out of scope tracking',
      has_in_scope_fixes: false,
      out_of_scope_issues: [123, -456, 789],
    };

    // Validation should happen BEFORE state detection
    // So this should throw immediately without needing GitHub access
    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('Invalid issue numbers'));
        assert(err.message.includes('-456'));
        return true;
      }
    );
  });
});

describe('complete-fix validation (Priority 3: Error recovery paths)', () => {
  it('should throw helpful error when fix_description is empty', async () => {
    const input: CompleteFixInput = {
      fix_description: '',
      has_in_scope_fixes: true,
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('fix_description is required'));
        assert(err.message.includes('cannot be empty'));
        assert(err.message.includes('Received:'), 'Should show received value');
        assert(err.message.includes('type:'), 'Should show type');
        assert(err.message.includes('length:'), 'Should show length');
        assert(
          err.message.includes('meaningful description'),
          'Should guide user to provide description'
        );
        return true;
      }
    );
  });

  it('should throw helpful error when fix_description is whitespace only', async () => {
    const input: CompleteFixInput = {
      fix_description: '   \n\t  ',
      has_in_scope_fixes: true,
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('fix_description is required'));
        assert(err.message.includes('cannot be empty'));
        assert(err.message.includes('meaningful description'));
        return true;
      }
    );
  });

  // NOTE: Testing phase-specific errors (missing issue in phase1, missing PR in phase2)
  // requires GitHub API access to detect current state. Those are integration tests
  // tracked in issue #313 for future implementation with proper mocking infrastructure.
});

describe('complete-fix validation (Priority 4: Fast-path behavior)', () => {
  it('should validate fix_description even on fast-path', async () => {
    const input: CompleteFixInput = {
      fix_description: '',
      has_in_scope_fixes: false,
      out_of_scope_issues: [123],
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('fix_description is required'));
        return true;
      }
    );
  });

  it('should validate out_of_scope_issues even on fast-path', async () => {
    const input: CompleteFixInput = {
      fix_description: 'Invalid issues tracked',
      has_in_scope_fixes: false,
      out_of_scope_issues: [123, -456],
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('Invalid issue numbers'));
        assert(err.message.includes('-456'));
        return true;
      }
    );
  });

  it('should perform all validation before state detection on fast-path', async () => {
    // Test that validation happens synchronously before async state detection
    const input: CompleteFixInput = {
      fix_description: '   ', // whitespace only - invalid
      has_in_scope_fixes: false,
      out_of_scope_issues: [123, 0, -1], // invalid numbers
    };

    await assert.rejects(
      async () => completeFix(input),
      (err: Error) => {
        assert(err instanceof ValidationError);
        // Should fail on FIRST validation error (fix_description)
        // before even checking out_of_scope_issues
        assert(err.message.includes('fix_description is required'));
        return true;
      }
    );
  });

  // NOTE: Testing that fast-path skips state update and comment posting
  // requires mocking GitHub API calls. This is an integration test tracked
  // in issue #313 for future implementation.
});

describe('complete-fix fast-path behavior (Documentation)', () => {
  it('documents expected fast-path behavior when has_in_scope_fixes is false', () => {
    /**
     * FAST-PATH BEHAVIOR SPECIFICATION
     *
     * When has_in_scope_fixes=false, wiggum_complete_fix takes the "fast-path":
     *
     * 1. VALIDATION: All input validation still occurs (fix_description, out_of_scope_issues)
     *
     * 2. STATE UPDATE: Creates new state with:
     *    - iteration: UNCHANGED (no increment - no fixes were made)
     *    - step: Current step (unchanged)
     *    - completedSteps: Current step ADDED to completedSteps array
     *    - phase: Current phase (unchanged)
     *
     * 3. COMMENT POSTING: Posts minimal state comment to GitHub:
     *    - Title: "{step} - Complete (No In-Scope Fixes)"
     *    - Body: Fix description + out-of-scope issues (if any)
     *    - Location: Issue (Phase 1) or PR (Phase 2)
     *
     * 4. ROUTER CALL: Calls getNextStepInstructions(updatedState)
     *    - Router sees current step in completedSteps
     *    - Router advances to NEXT step (not stuck on current step)
     *
     * RATIONALE:
     * - Marking step complete prevents infinite loop (router advancing properly)
     * - Keeping iteration unchanged reflects reality (no fixes were applied)
     * - Posting state comment provides audit trail for fast-path execution
     *
     * CONTRAST WITH NORMAL PATH (has_in_scope_fixes=true):
     * - Normal path: Increments iteration, filters completedSteps, posts detailed fix comment
     * - Fast-path: Keeps iteration, appends to completedSteps, posts minimal completion comment
     *
     * This test serves as executable documentation of the fast-path behavior.
     * It does not execute the actual fast-path (that requires GitHub API mocking,
     * tracked in issue #313), but documents the expected behavior for developers.
     */
    assert.ok(true, 'Fast-path behavior documented');
  });
});
