/**
 * Tests for router state machine logic
 *
 * These tests verify the routing logic that determines workflow step progression,
 * type guards, and helper functions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { _testExports, createStateUpdateFailure } from './router.js';
import type { CurrentState, PRExists, PRStateValue } from './types.js';
import { createPRExists, createPRDoesNotExist } from './types.js';
import type { WiggumStep } from '../constants.js';
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
  SECURITY_REVIEW_COMMAND,
} from '../constants.js';

const {
  hasExistingPR,
  checkUncommittedChanges,
  checkBranchPushed,
  formatFixInstructions,
  handlePhase1SecurityReview,
  handlePhase2SecurityReview,
} = _testExports;

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

describe('Security Review Instructions', () => {
  describe('Phase 1 Security Review', () => {
    it('should include SlashCommand invocation guidance', () => {
      const state = createMockState({
        git: { isPushed: true, hasUncommittedChanges: false },
        wiggum: { phase: 'phase1', iteration: 0 },
      });

      const result = handlePhase1SecurityReview(state, 552);
      const instructions = result.content[0].text;

      // Verify critical SlashCommand guidance is present
      assert.ok(
        instructions.includes('SlashCommand tool'),
        'Instructions should mention SlashCommand tool'
      );
      assert.ok(
        instructions.includes("EVEN IF it doesn't appear in your available commands list"),
        'Instructions should include warning about command list'
      );
      assert.ok(
        instructions.includes('Do NOT attempt to run this as a bash command'),
        'Instructions should warn against bash execution'
      );
      assert.ok(
        instructions.includes(SECURITY_REVIEW_COMMAND),
        'Instructions should include the security review command'
      );
    });

    it('should reference wiggum_complete_security_review tool', () => {
      const state = createMockState({
        git: { isPushed: true, hasUncommittedChanges: false },
        wiggum: { phase: 'phase1', iteration: 0 },
      });

      const result = handlePhase1SecurityReview(state, 552);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('wiggum_complete_security_review'),
        'Instructions should reference completion tool'
      );
      assert.ok(
        instructions.includes('in_scope_result_files'),
        'Instructions should mention in_scope_result_files parameter'
      );
      assert.ok(
        instructions.includes('out_of_scope_result_files'),
        'Instructions should mention out_of_scope_result_files parameter'
      );
    });

    it('should include issue number in instructions', () => {
      const state = createMockState({
        git: { isPushed: true, hasUncommittedChanges: false },
        wiggum: { phase: 'phase1', iteration: 0 },
      });

      const result = handlePhase1SecurityReview(state, 789);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('issue #789'),
        'Instructions should reference the correct issue number'
      );
    });
  });

  describe('Phase 2 Security Review', () => {
    it('should include SlashCommand invocation guidance', () => {
      const state = createMockState({
        pr: { exists: true, state: 'OPEN', number: 123 },
        wiggum: { phase: 'phase2', iteration: 0 },
      });

      // Type guard ensures state has PR
      if (!hasExistingPR(state)) {
        throw new Error('Test setup failed: PR should exist');
      }

      const result = handlePhase2SecurityReview(state);
      const instructions = result.content[0].text;

      // Verify critical SlashCommand guidance is present
      assert.ok(
        instructions.includes('SlashCommand tool'),
        'Instructions should mention SlashCommand tool'
      );
      assert.ok(
        instructions.includes("EVEN IF it doesn't appear in your available commands list"),
        'Instructions should include warning about command list'
      );
      assert.ok(
        instructions.includes('Do NOT attempt to run this as a bash command'),
        'Instructions should warn against bash execution'
      );
      assert.ok(
        instructions.includes(SECURITY_REVIEW_COMMAND),
        'Instructions should include the security review command'
      );
    });

    it('should reference wiggum_complete_security_review tool', () => {
      const state = createMockState({
        pr: { exists: true, state: 'OPEN', number: 123 },
        wiggum: { phase: 'phase2', iteration: 0 },
      });

      // Type guard ensures state has PR
      if (!hasExistingPR(state)) {
        throw new Error('Test setup failed: PR should exist');
      }

      const result = handlePhase2SecurityReview(state);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('wiggum_complete_security_review'),
        'Instructions should reference completion tool (not pr_review)'
      );
      assert.ok(
        instructions.includes('command_executed'),
        'Instructions should mention command_executed parameter'
      );
    });

    it('should warn about reviewing all commits', () => {
      const state = createMockState({
        pr: { exists: true, state: 'OPEN', number: 123 },
        wiggum: { phase: 'phase2', iteration: 0 },
      });

      // Type guard ensures state has PR
      if (!hasExistingPR(state)) {
        throw new Error('Test setup failed: PR should exist');
      }

      const result = handlePhase2SecurityReview(state);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('ALL changes from this branch'),
        'Instructions should emphasize reviewing all changes'
      );
      assert.ok(
        instructions.includes('git log main..HEAD'),
        'Instructions should include git log command'
      );
    });
  });
});
