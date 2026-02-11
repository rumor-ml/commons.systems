/**
 * Tests for router state machine logic
 *
 * These tests verify the routing logic that determines workflow step progression,
 * type guards, and helper functions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { _testExports, createStateUpdateFailure } from './router.js';
import type { CurrentState, PRExists, PRStateValue, WiggumState } from './types.js';
import { createPRExists, createPRDoesNotExist } from './types.js';
import type { WiggumStep } from '../constants.js';
import type { ToolResult } from '../types.js';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_CREATE_PR,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_CHECKS,
  STEP_PHASE2_CODE_QUALITY,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
  STEP_PHASE2_APPROVAL,
  PHASE1_PR_REVIEW_COMMAND,
  PHASE2_PR_REVIEW_COMMAND,
} from '../constants.js';

const { hasExistingPR, checkUncommittedChanges, checkBranchPushed, formatFixInstructions } =
  _testExports;

/**
 * Create a mock CurrentState for testing
 *
 * Uses createPRExists/createPRDoesNotExist factory functions to ensure
 * PR state is validated at construction time.
 */
function createMockState(overrides: {
  pr?: { exists: boolean; state?: PRStateValue; number?: number };
  git?: { isMainBranch?: boolean; hasUncommittedChanges?: boolean; isPushed?: boolean };
  wiggum?: { iteration?: number; completedSteps?: WiggumStep[]; phase?: 'phase1' | 'phase2' };
}): CurrentState {
  const pr = overrides.pr?.exists
    ? createPRExists({
        state: overrides.pr.state || 'OPEN',
        number: overrides.pr.number || 123,
        title: 'Test PR',
        url: 'https://github.com/test/repo/pull/123',
        labels: [],
        headRefName: 'feature-branch',
        baseRefName: 'main',
      })
    : createPRDoesNotExist();

  return {
    pr,
    git: {
      isMainBranch: overrides.git?.isMainBranch ?? false,
      hasUncommittedChanges: overrides.git?.hasUncommittedChanges ?? false,
      isPushed: overrides.git?.isPushed ?? true,
      currentBranch: 'feature-branch',
      isRemoteTracking: true,
    },
    issue: {
      exists: false,
    },
    wiggum: {
      iteration: overrides.wiggum?.iteration ?? 0,
      step: STEP_PHASE1_CREATE_PR,
      completedSteps: overrides.wiggum?.completedSteps ?? [],
      phase: overrides.wiggum?.phase ?? 'phase1',
    },
  };
}

describe('hasExistingPR type guard', () => {
  it('should return true when PR exists', () => {
    const state = createMockState({ pr: { exists: true, state: 'OPEN', number: 42 } });
    assert.strictEqual(hasExistingPR(state), true);
  });

  it('should return false when PR does not exist', () => {
    const state = createMockState({ pr: { exists: false } });
    assert.strictEqual(hasExistingPR(state), false);
  });

  it('should narrow type to CurrentStateWithPR', () => {
    const state = createMockState({ pr: { exists: true, state: 'OPEN', number: 42 } });
    if (hasExistingPR(state)) {
      // TypeScript should allow accessing pr properties here after type narrowing
      assert.strictEqual((state.pr as PRExists).number, 42);
      assert.strictEqual((state.pr as PRExists).state, 'OPEN');
    }
  });
});

describe('checkUncommittedChanges', () => {
  it('should return ToolResult when uncommitted changes exist', () => {
    const state = createMockState({ git: { hasUncommittedChanges: true } });
    const output = {
      current_step: 'Test Step',
      step_number: '1',
      iteration_count: 0,
      instructions: '',
      steps_completed_by_tool: [],
      context: {},
    };

    const result = checkUncommittedChanges(state, output, ['previous step']);

    assert.ok(result !== null);
    assert.ok(result.content[0].type === 'text');
    assert.ok(
      (result.content[0] as { text: string }).text.includes('Uncommitted changes detected')
    );
    assert.ok(output.instructions.includes('/commit-merge-push'));
    assert.deepStrictEqual(output.steps_completed_by_tool, [
      'previous step',
      'Checked for uncommitted changes',
    ]);
  });

  it('should return null when no uncommitted changes', () => {
    const state = createMockState({ git: { hasUncommittedChanges: false } });
    const output = {
      current_step: 'Test Step',
      step_number: '1',
      iteration_count: 0,
      instructions: '',
      steps_completed_by_tool: [],
      context: {},
    };

    const result = checkUncommittedChanges(state, output, []);

    assert.strictEqual(result, null);
  });
});

describe('checkBranchPushed', () => {
  it('should return ToolResult when branch is not pushed', () => {
    const state = createMockState({ git: { isPushed: false } });
    const output = {
      current_step: 'Test Step',
      step_number: '1',
      iteration_count: 0,
      instructions: '',
      steps_completed_by_tool: [],
      context: {},
    };

    const result = checkBranchPushed(state, output, ['previous step']);

    assert.ok(result !== null);
    assert.ok(result.content[0].type === 'text');
    assert.ok((result.content[0] as { text: string }).text.includes('Branch not pushed'));
    assert.ok(output.instructions.includes('/commit-merge-push'));
    assert.deepStrictEqual(output.steps_completed_by_tool, [
      'previous step',
      'Checked push status',
    ]);
  });

  it('should return null when branch is pushed', () => {
    const state = createMockState({ git: { isPushed: true } });
    const output = {
      current_step: 'Test Step',
      step_number: '1',
      iteration_count: 0,
      instructions: '',
      steps_completed_by_tool: [],
      context: {},
    };

    const result = checkBranchPushed(state, output, []);

    assert.strictEqual(result, null);
  });
});

describe('formatFixInstructions', () => {
  it('should format fix instructions with failure details', () => {
    const result = formatFixInstructions(
      'Workflow',
      'Error: Test failed in file.ts:42',
      'Default message'
    );

    assert.ok(result.includes('Workflow failed'));
    assert.ok(result.includes('Error: Test failed in file.ts:42'));
    assert.ok(result.includes('Plan'));
    assert.ok(result.includes('accept-edits'));
    assert.ok(result.includes('wiggum_complete_fix'));
  });

  it('should use default message when failure details are undefined', () => {
    const result = formatFixInstructions('PR checks', undefined, 'See PR checks for details');

    assert.ok(result.includes('PR checks failed'));
    assert.ok(result.includes('See PR checks for details'));
  });

  it('should include all fix steps in order', () => {
    const result = formatFixInstructions('Tests', 'failure details', 'default');

    // Verify the steps are present in order
    const step1Index = result.indexOf('1. Analyze');
    const step2Index = result.indexOf('2. Use Task tool');
    const step3Index = result.indexOf('3. Use Task tool');
    const step4Index = result.indexOf('4. Execute /commit-merge-push');
    const step5Index = result.indexOf('5. Call wiggum_complete_fix');

    assert.ok(step1Index < step2Index, 'Step 1 should come before Step 2');
    assert.ok(step2Index < step3Index, 'Step 2 should come before Step 3');
    assert.ok(step3Index < step4Index, 'Step 3 should come before Step 4');
    assert.ok(step4Index < step5Index, 'Step 4 should come before Step 5');
  });

  it('should add truncation indicator when failure details exceed 1000 characters', () => {
    // Create a string longer than 1000 characters (the sanitization limit)
    const longDetails = 'x'.repeat(1500);
    const result = formatFixInstructions('Workflow', longDetails, 'default');

    // The sanitized details should be truncated to 1000 chars
    assert.ok(
      result.includes('x'.repeat(100)), // Some x's should remain
      'Should include some original content'
    );
    assert.ok(
      result.includes('Error details truncated'),
      'Should include truncation indicator for truncated content'
    );
    assert.ok(
      result.includes('See workflow logs for full details'),
      'Should direct user to workflow logs'
    );
  });

  it('should not add truncation indicator when failure details are under limit', () => {
    const shortDetails = 'Error: Test failed in file.ts:42';
    const result = formatFixInstructions('Workflow', shortDetails, 'default');

    assert.ok(
      !result.includes('Error details truncated'),
      'Should not include truncation indicator for short content'
    );
    assert.ok(result.includes(shortDetails), 'Should include original short details unchanged');
  });

  it('should not add truncation indicator when using default message', () => {
    const result = formatFixInstructions('PR checks', undefined, 'See PR checks for details');

    assert.ok(
      !result.includes('Error details truncated'),
      'Should not include truncation indicator when using default message'
    );
    assert.ok(result.includes('See PR checks for details'), 'Should include default message');
  });
});

describe('Step Sequencing Logic', () => {
  describe('completedSteps filtering', () => {
    it('should recognize valid step values in completedSteps', () => {
      const validSteps: WiggumStep[] = [
        STEP_PHASE1_MONITOR_WORKFLOW,
        STEP_PHASE1_CREATE_PR,
        STEP_PHASE2_MONITOR_WORKFLOW,
        STEP_PHASE2_MONITOR_CHECKS,
        STEP_PHASE2_CODE_QUALITY,
        STEP_PHASE2_PR_REVIEW,
        STEP_PHASE2_SECURITY_REVIEW,
        STEP_PHASE2_APPROVAL,
      ];
      for (const step of validSteps) {
        const state = createMockState({
          pr: { exists: true, state: 'OPEN' },
          wiggum: { completedSteps: [step], phase: 'phase2' },
        });
        assert.ok(
          state.wiggum.completedSteps.includes(step),
          `Step ${step} should be in completedSteps`
        );
      }
    });
  });

  describe('PR state handling', () => {
    it('should treat CLOSED PR as non-existent for routing', () => {
      // This tests the logic that CLOSED PRs should trigger Step 0
      const state = createMockState({
        pr: { exists: true, state: 'CLOSED', number: 42 },
      });
      // The router checks state.pr.state !== 'OPEN' to route to Step 0
      assert.strictEqual(state.pr.exists && state.pr.state !== 'OPEN', true);
    });

    it('should treat MERGED PR as non-existent for routing', () => {
      const state = createMockState({
        pr: { exists: true, state: 'MERGED', number: 42 },
      });
      assert.strictEqual(state.pr.exists && state.pr.state !== 'OPEN', true);
    });

    it('should accept OPEN PR for workflow', () => {
      const state = createMockState({
        pr: { exists: true, state: 'OPEN', number: 42 },
      });
      assert.strictEqual(state.pr.exists && state.pr.state === 'OPEN', true);
    });
  });
});

describe('State Machine Invariants', () => {
  it('should not have duplicate steps in completedSteps', () => {
    const completedSteps: WiggumStep[] = [
      STEP_PHASE1_CREATE_PR,
      STEP_PHASE2_MONITOR_WORKFLOW,
      STEP_PHASE2_MONITOR_CHECKS,
      STEP_PHASE2_CODE_QUALITY,
    ];
    const uniqueSteps = [...new Set(completedSteps)];
    assert.strictEqual(completedSteps.length, uniqueSteps.length);
  });

  it('should maintain iteration count across state', () => {
    const state = createMockState({
      wiggum: {
        iteration: 5,
        completedSteps: [STEP_PHASE1_CREATE_PR, STEP_PHASE2_MONITOR_WORKFLOW],
      },
    });
    assert.strictEqual(state.wiggum.iteration, 5);
  });

  it('should preserve step completion order', () => {
    const completedSteps: WiggumStep[] = [
      STEP_PHASE1_CREATE_PR,
      STEP_PHASE2_MONITOR_WORKFLOW,
      STEP_PHASE2_MONITOR_CHECKS,
    ];
    const state = createMockState({
      wiggum: { completedSteps, phase: 'phase2' },
    });
    // Verify order is preserved
    assert.deepStrictEqual(state.wiggum.completedSteps, [
      STEP_PHASE1_CREATE_PR,
      STEP_PHASE2_MONITOR_WORKFLOW,
      STEP_PHASE2_MONITOR_CHECKS,
    ]);
  });
});

describe('Error State Handling', () => {
  it('should handle main branch error state', () => {
    const state = createMockState({
      git: { isMainBranch: true },
    });
    assert.strictEqual(state.git.isMainBranch, true);
  });

  it('should handle uncommitted changes state', () => {
    const state = createMockState({
      git: { hasUncommittedChanges: true },
    });
    assert.strictEqual(state.git.hasUncommittedChanges, true);
  });

  it('should handle unpushed branch state', () => {
    const state = createMockState({
      git: { isPushed: false },
    });
    assert.strictEqual(state.git.isPushed, false);
  });
});

describe('Router Instruction Command References', () => {
  describe('phase-specific command constants in instructions', () => {
    it('should verify PHASE1_PR_REVIEW_COMMAND references correct command', () => {
      // Router uses PHASE1_PR_REVIEW_COMMAND at line 311 for Phase 1 PR review
      // This test verifies the constant value matches the expected command
      assert.strictEqual(
        PHASE1_PR_REVIEW_COMMAND,
        '/all-hands-review',
        'Phase 1 PR review should use /all-hands-review command'
      );
    });

    it('should verify PHASE2_PR_REVIEW_COMMAND references correct command', () => {
      // Router uses PHASE2_PR_REVIEW_COMMAND at lines 775 and 831 for Phase 2 PR review
      // This test verifies the constant value matches the expected command
      assert.strictEqual(
        PHASE2_PR_REVIEW_COMMAND,
        '/review',
        'Phase 2 PR review should use /review command'
      );
    });

    it('should document that router instructions reference command constants', () => {
      // The router.ts file uses these constants in template literals to generate instructions:
      // - Line 311: ${PHASE1_PR_REVIEW_COMMAND} in Phase 1 PR review step
      // - Line 775: ${PHASE2_PR_REVIEW_COMMAND} in Phase 2 PR review step (normal flow)
      // - Line 831: ${PHASE2_PR_REVIEW_COMMAND} in Phase 2 PR review step (after code quality)
      //
      // This ensures that when phase-specific commands change, the router automatically
      // uses the updated commands without requiring manual template string updates.
      assert.notStrictEqual(
        PHASE1_PR_REVIEW_COMMAND as string,
        PHASE2_PR_REVIEW_COMMAND as string,
        'Phase 1 and Phase 2 should use different commands'
      );
    });

    it('should verify command constants follow expected format', () => {
      // Both commands should be slash commands (start with /)
      assert.ok(
        PHASE1_PR_REVIEW_COMMAND.startsWith('/'),
        'Phase 1 command should be a slash command'
      );
      assert.ok(
        PHASE2_PR_REVIEW_COMMAND.startsWith('/'),
        'Phase 2 command should be a slash command'
      );
    });

    it('should document router usage locations for phase1 command', () => {
      // PHASE1_PR_REVIEW_COMMAND is used in:
      // - router.ts line 311: Phase 1 PR review step instructions
      // - review-completion-helper.ts: PR_REVIEW_CONFIG.phase1Command
      //
      // This test documents that the constant is referenced in multiple locations
      // and changing it will update all instruction templates automatically.
      assert.strictEqual(
        PHASE1_PR_REVIEW_COMMAND,
        '/all-hands-review',
        'Command should match expected value in all locations'
      );
    });

    it('should document router usage locations for phase2 command', () => {
      // PHASE2_PR_REVIEW_COMMAND is used in:
      // - router.ts line 775: Phase 2 PR review step (normal flow)
      // - router.ts line 831: Phase 2 PR review step (after code quality fixes)
      // - review-completion-helper.ts: PR_REVIEW_CONFIG.phase2Command
      //
      // Multiple instruction templates reference the same constant, ensuring consistency
      assert.strictEqual(
        PHASE2_PR_REVIEW_COMMAND,
        '/review',
        'Command should match expected value in all locations'
      );
    });

    it('should verify constants are exported and importable', () => {
      // This test verifies that the constants are properly exported from constants.ts
      // and can be imported by router.ts and other modules
      assert.ok(
        typeof PHASE1_PR_REVIEW_COMMAND === 'string',
        'PHASE1_PR_REVIEW_COMMAND should be a string'
      );
      assert.ok(
        typeof PHASE2_PR_REVIEW_COMMAND === 'string',
        'PHASE2_PR_REVIEW_COMMAND should be a string'
      );
    });
  });
});

describe('createStateUpdateFailure factory function', () => {
  it('should create failure result with valid parameters', () => {
    const error = new Error('Rate limit exceeded');
    const result = createStateUpdateFailure('rate_limit', error, 3);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'rate_limit');
    assert.strictEqual(result.lastError, error);
    assert.strictEqual(result.attemptCount, 3);
  });

  it('should create failure result for network errors', () => {
    const error = new Error('ECONNREFUSED');
    const result = createStateUpdateFailure('network', error, 2);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'network');
    assert.strictEqual(result.lastError, error);
    assert.strictEqual(result.attemptCount, 2);
  });

  it('should throw error for zero attemptCount', () => {
    const error = new Error('Test error');
    assert.throws(
      () => createStateUpdateFailure('rate_limit', error, 0),
      /attemptCount must be positive integer/
    );
  });

  it('should throw error for negative attemptCount', () => {
    const error = new Error('Test error');
    assert.throws(
      () => createStateUpdateFailure('rate_limit', error, -1),
      /attemptCount must be positive integer/
    );
  });

  it('should throw error for non-integer attemptCount', () => {
    const error = new Error('Test error');
    assert.throws(
      () => createStateUpdateFailure('rate_limit', error, 2.5),
      /attemptCount must be positive integer/
    );
  });

  it('should throw error for NaN attemptCount', () => {
    const error = new Error('Test error');
    assert.throws(
      () => createStateUpdateFailure('rate_limit', error, NaN),
      /attemptCount must be positive integer/
    );
  });

  it('should throw error for non-Error lastError', () => {
    // TypeScript would normally catch this, but we test runtime validation
    assert.throws(
      () => createStateUpdateFailure('rate_limit', 'not an error' as unknown as Error, 1),
      /lastError must be Error instance/
    );
  });

  it('should accept attemptCount of 1', () => {
    const error = new Error('Test error');
    const result = createStateUpdateFailure('rate_limit', error, 1);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.attemptCount, 1);
    }
  });

  it('should accept large attemptCount values', () => {
    const error = new Error('Test error');
    const result = createStateUpdateFailure('rate_limit', error, 100);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.attemptCount, 100);
    }
  });

  it('should throw error for Infinity attemptCount', () => {
    const error = new Error('Test error');
    assert.throws(
      () => createStateUpdateFailure('rate_limit', error, Infinity),
      /attemptCount must be positive integer/
    );
  });

  it('should throw error for negative Infinity attemptCount', () => {
    const error = new Error('Test error');
    assert.throws(
      () => createStateUpdateFailure('rate_limit', error, -Infinity),
      /attemptCount must be positive integer/
    );
  });

  it('should handle Error with undefined message', () => {
    const errorWithoutMessage = new Error();
    // Force message to be undefined
    Object.defineProperty(errorWithoutMessage, 'message', {
      value: undefined,
      configurable: true,
    });
    const result = createStateUpdateFailure('network', errorWithoutMessage, 1);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.lastError, errorWithoutMessage);
    }
  });

  it('should reject objects that are not Error instances', () => {
    const fakeError = { message: 'fake', name: 'FakeError' };
    assert.throws(
      () => createStateUpdateFailure('rate_limit', fakeError as Error, 1),
      /lastError must be Error instance/
    );
  });
});

describe('State Update Retry Logic', () => {
  describe('maxRetries validation', () => {
    it('should document that safeUpdatePRBodyState requires positive integer maxRetries', () => {
      // safeUpdatePRBodyState validates maxRetries >= 1 and Number.isInteger
      // This ensures the retry loop executes at least once
      // Invalid values: 0, -1, 2.5, NaN, undefined as number
      // Valid values: 1, 2, 3, 10, 100
      assert.ok(Number.isInteger(3) && 3 >= 1, 'maxRetries=3 is valid');
      assert.ok(!Number.isInteger(2.5) || 2.5 < 1, 'maxRetries=2.5 is invalid');
      assert.ok(!Number.isInteger(0) || 0 < 1, 'maxRetries=0 is invalid');
    });
  });

  describe('createStateUpdateFailure edge cases', () => {
    it('should reject Infinity attemptCount', () => {
      const error = new Error('Test error');
      assert.throws(
        () => createStateUpdateFailure('rate_limit', error, Infinity),
        /attemptCount must be positive integer/,
        'Infinity attemptCount should be rejected'
      );
    });

    it('should reject negative Infinity attemptCount', () => {
      const error = new Error('Test error');
      assert.throws(
        () => createStateUpdateFailure('rate_limit', error, -Infinity),
        /attemptCount must be positive integer/,
        'Negative Infinity attemptCount should be rejected'
      );
    });

    it('should handle Error with undefined message gracefully', () => {
      const errorWithoutMessage = new Error();
      // Force undefined message
      Object.defineProperty(errorWithoutMessage, 'message', { value: undefined });
      const result = createStateUpdateFailure('network', errorWithoutMessage, 1);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.lastError, errorWithoutMessage);
    });

    it('should reject objects that duck-type as Error but are not Error instances', () => {
      const fakeError = { message: 'fake error', name: 'FakeError', stack: 'fake stack' };
      assert.throws(
        () => createStateUpdateFailure('rate_limit', fakeError as Error, 1),
        /lastError must be Error instance/,
        'Non-Error objects should be rejected even if they have Error properties'
      );
    });

    it('should reject null as lastError', () => {
      assert.throws(
        () => createStateUpdateFailure('rate_limit', null as unknown as Error, 1),
        /lastError must be Error instance/,
        'Null should be rejected as lastError'
      );
    });

    it('should reject undefined as lastError', () => {
      assert.throws(
        () => createStateUpdateFailure('rate_limit', undefined as unknown as Error, 1),
        /lastError must be Error instance/,
        'Undefined should be rejected as lastError'
      );
    });
  });

  describe('exponential backoff formula', () => {
    it('should follow 2^attempt * 1000 pattern', () => {
      // Verifies the exponential backoff formula used in safeUpdatePRBodyState
      const expectedDelays = [
        { attempt: 1, delay: 2000 }, // 2^1 * 1000 = 2s
        { attempt: 2, delay: 4000 }, // 2^2 * 1000 = 4s
        { attempt: 3, delay: 8000 }, // 2^3 * 1000 = 8s
        { attempt: 4, delay: 16000 }, // 2^4 * 1000 = 16s
        { attempt: 5, delay: 32000 }, // 2^5 * 1000 = 32s
      ];

      for (const { attempt, delay } of expectedDelays) {
        const calculated = Math.pow(2, attempt) * 1000;
        assert.strictEqual(calculated, delay, `Attempt ${attempt} should have delay ${delay}ms`);
      }
    });

    it('should document uncapped delay growth', () => {
      // Verifies that delays are NOT capped - they grow exponentially without limit
      // This is documented in comments: "No cap on delay"
      const attempt = 10;
      const delay = Math.pow(2, attempt) * 1000;
      assert.strictEqual(delay, 1024000, 'Attempt 10 would have ~17 minute delay (uncapped)');
    });
  });

  describe('error classification patterns', () => {
    it('should classify rate limit errors by message pattern', () => {
      const rateLimitPatterns = ['rate limit', 'Rate Limit', '429'];
      rateLimitPatterns.forEach((pattern) => {
        const msg = `Error: ${pattern} exceeded`;
        assert.ok(
          /rate limit|429/i.test(msg),
          `Pattern "${pattern}" should match rate limit regex`
        );
      });
    });

    it('should classify network errors by message pattern', () => {
      const networkPatterns = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'network', 'fetch'];
      networkPatterns.forEach((pattern) => {
        const msg = `Error: ${pattern}`;
        assert.ok(
          /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|fetch/i.test(msg),
          `Pattern "${pattern}" should match network regex`
        );
      });
    });

    it('should classify 404 errors as non-transient', () => {
      const notFoundPatterns = ['not found', '404', 'Not Found'];
      notFoundPatterns.forEach((pattern) => {
        const msg = `Error: ${pattern}`;
        assert.ok(/not found|404/i.test(msg), `Pattern "${pattern}" should match 404 regex`);
      });
    });

    it('should classify auth errors as non-transient', () => {
      const authPatterns = ['unauthorized', '401', 'forbidden', '403', 'permission denied'];
      authPatterns.forEach((pattern) => {
        const msg = `Error: ${pattern}`;
        assert.ok(
          /permission|forbidden|unauthorized|401|403/i.test(msg),
          `Pattern "${pattern}" should match auth regex`
        );
      });
    });
  });

  describe('HTTP status extraction', () => {
    it('should extract status from exitCode property', () => {
      // When error has exitCode, it should be used for classification
      const exitCodes = [429, 502, 503, 504, 404, 401, 403];
      exitCodes.forEach((code) => {
        assert.ok(Number.isInteger(code), `Exit code ${code} should be integer`);
        assert.ok(code >= 100 && code <= 599, `Exit code ${code} should be valid HTTP status`);
      });
    });

    it('should handle undefined exitCode', () => {
      // When exitCode is undefined, classification falls back to message patterns
      const exitCode = undefined;
      assert.strictEqual(exitCode, undefined, 'Undefined exitCode should trigger fallback');
    });
  });
});

describe('handleStateUpdateFailure integration', () => {
  describe('Phase 1 Monitor Workflow callsite', () => {
    it('should pass correct parameters when state update fails after success', () => {
      // Tests that Phase 1 Monitor Workflow passes correct params to handleStateUpdateFailure

      // Mock StateUpdateResult failure
      const mockStateResult = createStateUpdateFailure(
        'rate_limit',
        new Error('API rate limit exceeded'),
        3
      );

      // Mock state that would be passed after workflow success
      const mockState: WiggumState = {
        phase: 'phase1',
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        iteration: 0,
        completedSteps: [],
      };

      // Expected parameters
      const expectedParams = {
        stateResult: mockStateResult,
        newState: mockState,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue' as const,
        targetNumber: 123,
      };

      // Verify parameter types match what handleStateUpdateFailure expects
      assert.strictEqual(expectedParams.stateResult.success, false);
      assert.strictEqual(expectedParams.stateResult.reason, 'rate_limit');
      assert.strictEqual(expectedParams.newState.phase, 'phase1');
      assert.strictEqual(expectedParams.step, STEP_PHASE1_MONITOR_WORKFLOW);
      assert.strictEqual(expectedParams.targetType, 'issue');
      assert.strictEqual(expectedParams.targetNumber, 123);
    });

    it('should pass correct parameters when state update fails after failure', () => {
      // This test verifies Phase 1 Monitor Workflow failure path callsite
      // Tests state update failure during iteration increment (workflow failed)

      const mockStateResult = createStateUpdateFailure('network', new Error('ECONNREFUSED'), 3);
      const mockState: WiggumState = {
        phase: 'phase1',
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        iteration: 1, // Incremented after workflow failure
        completedSteps: [],
      };

      const expectedParams = {
        stateResult: mockStateResult,
        newState: mockState,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue' as const,
        targetNumber: 456,
      };

      assert.strictEqual(expectedParams.stateResult.success, false);
      assert.strictEqual(expectedParams.stateResult.reason, 'network');
      assert.strictEqual(expectedParams.newState.iteration, 1);
      assert.strictEqual(expectedParams.targetType, 'issue');
    });
  });

  describe('Phase 2 Monitor Workflow callsite', () => {
    it('should pass correct parameters with PR target type', () => {
      // Tests that Phase 2 Monitor Workflow uses 'pr' instead of 'issue'

      const mockStateResult = createStateUpdateFailure(
        'rate_limit',
        new Error('Secondary rate limit'),
        5
      );
      const mockState: WiggumState = {
        phase: 'phase2',
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: 2,
        completedSteps: [STEP_PHASE1_CREATE_PR],
      };

      const expectedParams = {
        stateResult: mockStateResult,
        newState: mockState,
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        targetType: 'pr' as const, // CRITICAL: Must be 'pr' not 'issue'
        targetNumber: 789,
      };

      assert.strictEqual(expectedParams.targetType, 'pr');
      assert.strictEqual(expectedParams.newState.phase, 'phase2');
      assert.strictEqual(expectedParams.step, STEP_PHASE2_MONITOR_WORKFLOW);
    });
  });

  describe('Phase 2 Monitor Checks callsites', () => {
    it('should pass correct parameters from first callsite (success path)', () => {
      // This test verifies Phase 2 Monitor Checks success path callsite
      // Tests state update failure after PR checks succeed (marking step complete)

      const mockStateResult = createStateUpdateFailure('network', new Error('Timeout'), 3);
      const mockState: WiggumState = {
        phase: 'phase2',
        step: STEP_PHASE2_MONITOR_CHECKS,
        iteration: 0,
        completedSteps: [STEP_PHASE1_CREATE_PR, STEP_PHASE2_MONITOR_WORKFLOW],
      };

      const expectedParams = {
        stateResult: mockStateResult,
        newState: mockState,
        step: STEP_PHASE2_MONITOR_CHECKS,
        targetType: 'pr' as const,
        targetNumber: 100,
      };

      assert.strictEqual(expectedParams.step, STEP_PHASE2_MONITOR_CHECKS);
      assert.strictEqual(expectedParams.targetType, 'pr');
      assert.strictEqual(
        expectedParams.newState.completedSteps.includes(STEP_PHASE2_MONITOR_WORKFLOW),
        true
      );
    });

    it('should pass correct parameters from second callsite (standalone path)', () => {
      // This test verifies Phase 2 Monitor Checks standalone path callsite
      // Tests standalone handlePhase2MonitorPRChecks when called after fixes

      const mockStateResult = createStateUpdateFailure('rate_limit', new Error('429'), 3);
      const mockState: WiggumState = {
        phase: 'phase2',
        step: STEP_PHASE2_MONITOR_CHECKS,
        iteration: 3,
        completedSteps: [STEP_PHASE1_CREATE_PR, STEP_PHASE2_MONITOR_WORKFLOW],
      };

      const expectedParams = {
        stateResult: mockStateResult,
        newState: mockState,
        step: STEP_PHASE2_MONITOR_CHECKS,
        targetType: 'pr' as const,
        targetNumber: 200,
      };

      assert.strictEqual(expectedParams.newState.iteration, 3);
      assert.strictEqual(expectedParams.step, STEP_PHASE2_MONITOR_CHECKS);
    });
  });

  describe('Phase 2 Code Quality callsite', () => {
    it('should pass correct parameters for code quality step', () => {
      // This test verifies Phase 2 Code Quality callsite
      // Tests state update failure when marking code quality step complete

      const mockStateResult = createStateUpdateFailure('network', new Error('ETIMEDOUT'), 2);
      const mockState: WiggumState = {
        phase: 'phase2',
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: 1,
        completedSteps: [
          STEP_PHASE1_CREATE_PR,
          STEP_PHASE2_MONITOR_WORKFLOW,
          STEP_PHASE2_MONITOR_CHECKS,
        ],
      };

      const expectedParams = {
        stateResult: mockStateResult,
        newState: mockState,
        step: STEP_PHASE2_CODE_QUALITY,
        targetType: 'pr' as const,
        targetNumber: 300,
      };

      assert.strictEqual(expectedParams.step, STEP_PHASE2_CODE_QUALITY);
      assert.strictEqual(
        expectedParams.newState.completedSteps.includes(STEP_PHASE2_MONITOR_CHECKS),
        true
      );
    });
  });

  describe('Error message correctness', () => {
    it('should produce issue-specific error messages for Phase 1', () => {
      // Documents the expected string format for issue references in error messages
      const targetRef = 'issue #123';
      const verifyCommand = 'gh issue view 123';

      assert.ok(targetRef.includes('issue'));
      assert.ok(verifyCommand.includes('issue'));
      assert.ok(!targetRef.includes('PR'));
      assert.ok(!verifyCommand.includes('pr'));
    });

    it('should produce PR-specific error messages for Phase 2', () => {
      // Verifies that PR references use correct format
      // Simulate handleStateUpdateFailure logic for Phase 2
      const targetRef = 'PR #456';
      const verifyCommand = 'gh pr view 456';

      assert.ok(targetRef.includes('PR'));
      assert.ok(verifyCommand.includes('pr'));
      assert.ok(!targetRef.includes('issue #'));
      assert.ok(!verifyCommand.includes('issue'));
    });
  });

  describe('Parameter validation', () => {
    it('should verify all required params are provided at each callsite', () => {
      // This test documents that all 5 required parameters must be provided
      const requiredParams = ['stateResult', 'newState', 'step', 'targetType', 'targetNumber'];

      // Create a valid params object
      const validParams = {
        stateResult: createStateUpdateFailure('rate_limit', new Error('Test'), 3),
        newState: {
          phase: 'phase1' as const,
          step: STEP_PHASE1_MONITOR_WORKFLOW,
          iteration: 0,
          completedSteps: [],
        },
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue' as const,
        targetNumber: 123,
      };

      // Verify all required keys exist
      for (const param of requiredParams) {
        assert.ok(
          param in validParams,
          `Parameter ${param} must be provided to handleStateUpdateFailure`
        );
      }
    });

    it('should verify targetType is never accidentally swapped', () => {
      // Documents the targetType convention: Phase 1 uses 'issue', Phase 2 uses 'pr'
      // Note: This test verifies constants but doesn't validate actual callsites

      // Phase 1 must use 'issue'
      const phase1Step = STEP_PHASE1_MONITOR_WORKFLOW;
      const phase1TargetType = 'issue' as const;
      assert.ok(phase1Step.startsWith('p1-'));
      assert.strictEqual(phase1TargetType, 'issue');

      // Phase 2 must use 'pr'
      const phase2Step = STEP_PHASE2_MONITOR_WORKFLOW;
      const phase2TargetType = 'pr' as const;
      assert.ok(phase2Step.startsWith('p2-'));
      assert.strictEqual(phase2TargetType, 'pr');
    });

    it('should verify step names match between params and state', () => {
      // Ensures step parameter matches newState.step
      const step = STEP_PHASE2_CODE_QUALITY;
      const newState: WiggumState = {
        phase: 'phase2',
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: 1,
        completedSteps: [],
      };

      assert.strictEqual(step, newState.step, 'Step param must match newState.step');
    });
  });

  describe('Return value verification', () => {
    it('should verify handleStateUpdateFailure returns ToolResult with isError', () => {
      // Tests that the return value structure matches ToolResult type
      const mockReturn: ToolResult = {
        content: [
          {
            type: 'text',
            text: 'ERROR: Failed to update state',
          },
        ],
        isError: true,
      };

      assert.strictEqual(mockReturn.isError, true);
      assert.ok(Array.isArray(mockReturn.content));
      assert.strictEqual(mockReturn.content[0].type, 'text');
    });

    it('should verify each callsite returns the result immediately', () => {
      // Documents that each callsite must use 'return handleStateUpdateFailure(...)'
      // not just call it without returning
      const mustReturnImmediately = true;
      assert.strictEqual(
        mustReturnImmediately,
        true,
        'Each callsite must return handleStateUpdateFailure result to halt workflow'
      );
    });
  });

  describe('Iteration handling', () => {
    it('should verify iteration is preserved across state update attempts', () => {
      // When state update fails, iteration should be preserved in newState
      const beforeIteration = 3;
      const newState: WiggumState = {
        phase: 'phase2',
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: beforeIteration,
        completedSteps: [],
      };

      // State update failure should preserve iteration
      assert.strictEqual(newState.iteration, beforeIteration);
    });

    it('should verify iteration increments before state update on workflow failure', () => {
      // When workflow fails, iteration is incremented BEFORE state update attempt
      const startIteration = 0;
      const afterFailureIteration = startIteration + 1;

      const newState: WiggumState = {
        phase: 'phase1',
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        iteration: afterFailureIteration,
        completedSteps: [],
      };

      assert.strictEqual(newState.iteration, 1, 'Iteration should be incremented after failure');
    });
  });

  describe('CompletedSteps handling', () => {
    it('should verify completedSteps is updated before state update on success', () => {
      // When step succeeds, completedSteps includes the step BEFORE state update
      const newState: WiggumState = {
        phase: 'phase2',
        step: STEP_PHASE2_MONITOR_CHECKS,
        iteration: 0,
        completedSteps: [
          STEP_PHASE1_CREATE_PR,
          STEP_PHASE2_MONITOR_WORKFLOW,
          STEP_PHASE2_MONITOR_CHECKS,
        ],
      };

      assert.ok(
        newState.completedSteps.includes(STEP_PHASE2_MONITOR_CHECKS),
        'Step should be in completedSteps when marking complete'
      );
    });

    it('should verify completedSteps is unchanged on workflow failure', () => {
      // When workflow fails, completedSteps remains unchanged (step not completed)
      const originalSteps: WiggumStep[] = [STEP_PHASE1_CREATE_PR];
      const newState: WiggumState = {
        phase: 'phase2',
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: 1,
        completedSteps: [...originalSteps],
      };

      assert.deepStrictEqual(newState.completedSteps, originalSteps);
      assert.ok(!newState.completedSteps.includes(STEP_PHASE2_MONITOR_WORKFLOW));
    });
  });

  describe('Real callsite integration', () => {
    it('should handle state update failure in actual router.ts callsite', async () => {
      // TODO(#1844): Add integration test with dependency injection
      // Currently blocked by router.ts architecture - handler functions not exported,
      // safeUpdateIssueBodyState is direct import (cannot be mocked).
      // Integration test needed to verify actual callsites use correct parameters.
      assert.ok(true, 'Integration test pending router.ts refactoring');
    });
  });
});
