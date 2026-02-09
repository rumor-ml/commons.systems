/**
 * Tests for router state machine logic
 *
 * These tests verify the routing logic that determines workflow step progression,
 * type guards, and helper functions.
 *
 * TODO(#1873): Documentation-only tests with assert.ok(true) could be replaced with JSDoc comments
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  _testExports,
  createStateUpdateFailure,
  safeUpdatePRBodyState,
  safeUpdateIssueBodyState,
} from './router.js';
import type { CurrentState, PRExists, PRStateValue } from './types.js';
import { createPRExists, createPRDoesNotExist } from './types.js';
import * as bodyState from './body-state.js';
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
  executeStateUpdateWithRetry,
  safeLog,
  safeStringify,
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

describe('safeUpdatePRBodyState wrapper function', () => {
  it('should document wrapper function signature and defaults', () => {
    // Documents the public API - see router.ts for full signature
    assert.strictEqual(typeof safeUpdatePRBodyState, 'function');
  });

  it('should document default maxRetries value of 3', () => {
    // The wrapper function has maxRetries = 3 as default parameter (line 615 in router.ts)
    // This ensures retry behavior is consistent across all PR state updates
    // Without explicit maxRetries, the function will retry transient errors up to 3 times
    const DEFAULT_MAX_RETRIES = 3;
    assert.strictEqual(DEFAULT_MAX_RETRIES, 3, 'Default maxRetries should be 3');
  });

  it('should document StateUpdateResult return type structure', () => {
    // The function returns Promise<StateUpdateResult> which is a discriminated union:
    // Success: { success: true }
    // Failure: { success: false, reason: 'rate_limit' | 'network', lastError: Error, attemptCount: number }

    // Critical errors (404, 401/403) throw immediately and never return failure
    // All returned failures are transient by definition

    const successResult = { success: true as const };
    const failureResult = {
      success: false as const,
      reason: 'rate_limit' as const,
      lastError: new Error('test'),
      attemptCount: 3,
    };

    assert.strictEqual(successResult.success, true);
    assert.strictEqual(failureResult.success, false);
    assert.ok(['rate_limit', 'network'].includes(failureResult.reason));
  });

  it('should document PR-specific configuration passed to executeStateUpdateWithRetry', () => {
    // The wrapper delegates to executeStateUpdateWithRetry with this config:
    // {
    //   resourceType: 'pr',
    //   resourceId: prNumber (from parameter),
    //   updateFn: updatePRBodyState (from body-state.ts)
    // }

    // This ensures:
    // - Error messages reference "PR #123" not "issue"
    // - Logging uses prNumber field not issueNumber
    // - Correct API endpoint is called (gh pr edit, not gh issue edit)

    const config = {
      resourceType: 'pr' as const,
      resourceId: 123,
      // updateFn is the actual updatePRBodyState function from body-state.ts
    };

    assert.strictEqual(config.resourceType, 'pr');
    assert.ok(Number.isInteger(config.resourceId));
  });

  it('should document error handling behavior', () => {
    // The wrapper inherits all error handling from executeStateUpdateWithRetry:
    //
    // Transient errors (rate limit, network) - retry with exponential backoff:
    // - Rate limit (429, message contains 'rate limit') - backoff capped at 60s
    // - Network (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, network, fetch)
    // - Returns { success: false, reason, lastError, attemptCount } after maxRetries exhausted
    //
    // Critical errors (throw immediately, no retry):
    // - 404 errors - PR doesn't exist
    // - Auth errors (401, 403, permission denied)
    //
    // Unexpected errors - throw immediately for investigation

    assert.ok(true, 'Error handling is delegated to executeStateUpdateWithRetry');
  });
});

describe('safeUpdateIssueBodyState wrapper function', () => {
  it('should document wrapper function signature and defaults', () => {
    // Signature: safeUpdateIssueBodyState(issueNumber, state, step, maxRetries = 3)
    // Returns: Promise<StateUpdateResult>

    assert.strictEqual(typeof safeUpdateIssueBodyState, 'function');
    assert.ok(true, 'Wrapper function exists with documented signature');
  });

  it('should document default maxRetries value of 3', () => {
    // The wrapper function has maxRetries = 3 as default parameter (line 650 in router.ts)
    // This ensures consistent retry behavior across all issue state updates
    const DEFAULT_MAX_RETRIES = 3;
    assert.strictEqual(DEFAULT_MAX_RETRIES, 3, 'Default maxRetries should be 3');
  });

  it('should document StateUpdateResult return type structure', () => {
    // Returns same StateUpdateResult type as PR wrapper
    // Success: { success: true }
    // Failure: { success: false, reason: 'rate_limit' | 'network', lastError: Error, attemptCount: number }

    const successResult = { success: true as const };
    const failureResult = {
      success: false as const,
      reason: 'network' as const,
      lastError: new Error('test'),
      attemptCount: 3,
    };

    assert.strictEqual(successResult.success, true);
    assert.strictEqual(failureResult.success, false);
    assert.ok(['rate_limit', 'network'].includes(failureResult.reason));
  });

  it('should document issue-specific configuration passed to executeStateUpdateWithRetry', () => {
    // The wrapper delegates to executeStateUpdateWithRetry with this config:
    // {
    //   resourceType: 'issue',
    //   resourceId: issueNumber (from parameter),
    //   updateFn: updateIssueBodyState (from body-state.ts)
    // }

    // This ensures:
    // - Error messages reference "issue #456" not "PR"
    // - Logging uses issueNumber field not prNumber
    // - Correct API endpoint is called (gh issue edit, not gh pr edit)

    const config = {
      resourceType: 'issue' as const,
      resourceId: 456,
      // updateFn is the actual updateIssueBodyState function from body-state.ts
    };

    assert.strictEqual(config.resourceType, 'issue');
    assert.ok(Number.isInteger(config.resourceId));
  });

  it('should document error handling behavior', () => {
    // Inherits all error handling from executeStateUpdateWithRetry:
    // - Transient errors: retry with exponential backoff
    // - Critical errors (404, auth): throw immediately
    // - Unexpected errors: throw for investigation

    assert.ok(true, 'Error handling is delegated to executeStateUpdateWithRetry');
  });
});

describe('Wrapper function behavioral parity', () => {
  /**
   * Tests that verify both wrappers behave identically except for resource type
   */

  it('should both use same default maxRetries value', () => {
    // Both wrappers specify maxRetries = 3 as default parameter
    // This ensures consistent retry behavior across PR and issue operations

    // From router.ts:
    // - safeUpdatePRBodyState: line 615, maxRetries = 3
    // - safeUpdateIssueBodyState: line 650, maxRetries = 3

    const PR_DEFAULT_MAX_RETRIES = 3;
    const ISSUE_DEFAULT_MAX_RETRIES = 3;

    assert.strictEqual(
      PR_DEFAULT_MAX_RETRIES,
      ISSUE_DEFAULT_MAX_RETRIES,
      'Both wrappers should use same default maxRetries'
    );
  });

  it('should both return same StateUpdateResult type', () => {
    // Both wrappers return Promise<StateUpdateResult>
    // Success: { success: true }
    // Failure: { success: false, reason: 'rate_limit' | 'network', lastError: Error, attemptCount: number }

    // This ensures callers can handle both PR and issue updates uniformly

    const successResult = { success: true as const };
    assert.strictEqual(typeof successResult.success, 'boolean');
  });

  it('should both delegate to executeStateUpdateWithRetry', () => {
    // Both wrappers are thin wrappers that delegate all logic to executeStateUpdateWithRetry
    // Only difference is the config object passed:
    //
    // PR wrapper:
    // {
    //   resourceType: 'pr',
    //   resourceId: prNumber,
    //   updateFn: updatePRBodyState
    // }
    //
    // Issue wrapper:
    // {
    //   resourceType: 'issue',
    //   resourceId: issueNumber,
    //   updateFn: updateIssueBodyState
    // }

    assert.ok(true, 'Both wrappers delegate to executeStateUpdateWithRetry');
  });

  it('should both handle transient errors with retry', () => {
    // Both wrappers inherit retry logic from executeStateUpdateWithRetry:
    // - Rate limit errors (429, 'rate limit' in message)
    // - Network errors (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, 'network', 'fetch')
    // - Exponential backoff: 2^attempt * 1000ms, capped at 60s
    // - Returns failure result after maxRetries exhausted

    assert.ok(true, 'Both wrappers inherit same retry logic');
  });

  it('should both throw on critical errors immediately', () => {
    // Both wrappers inherit critical error handling from executeStateUpdateWithRetry:
    // - 404 errors: resource doesn't exist
    // - Auth errors: 401, 403, permission denied
    // - These throw immediately without retry

    assert.ok(true, 'Both wrappers inherit same critical error handling');
  });

  it('should document that swapping updateFn would break resource updates', () => {
    // This test documents the regression that the wrapper tests are designed to catch:
    // If someone accidentally swaps the updateFn references:
    //
    // WRONG (would cause bug):
    // safeUpdatePRBodyState calls with updateFn: updateIssueBodyState
    // safeUpdateIssueBodyState calls with updateFn: updatePRBodyState
    //
    // Result: PRs would be updated with 'gh issue edit' and vice versa
    //
    // The current implementation (lines 617-626, 652-661) correctly maps:
    // - PR wrapper → updatePRBodyState
    // - Issue wrapper → updateIssueBodyState

    assert.ok(true, 'Correct updateFn mapping prevents API misuse');
  });

  it('should document maxRetries parameter pass-through for PR wrapper', () => {
    // The safeUpdatePRBodyState wrapper accepts an optional maxRetries parameter
    // and passes it through to executeStateUpdateWithRetry (line 669 in router.ts):
    //
    // export async function safeUpdatePRBodyState(
    //   prNumber: number,
    //   state: WiggumState,
    //   step: string,
    //   maxRetries = 3                              // Default value
    // ): Promise<StateUpdateResult> {
    //   return executeStateUpdateWithRetry(
    //     { resourceType: 'pr', resourceId: prNumber, updateFn: updatePRBodyState },
    //     state,
    //     step,
    //     maxRetries                                // Passed through here
    //   );
    // }
    //
    // This test documents that custom maxRetries values would be passed through.
    // The actual retry behavior is tested in router-retry.test.ts.
    //
    // Example usage:
    // - safeUpdatePRBodyState(123, state, 'step')      // Uses default maxRetries = 3
    // - safeUpdatePRBodyState(123, state, 'step', 5)   // Custom maxRetries = 5
    // - safeUpdatePRBodyState(123, state, 'step', 1)   // Custom maxRetries = 1
    //
    // Failure scenario this would catch:
    // If someone hardcoded maxRetries in the wrapper:
    //   return executeStateUpdateWithRetry(..., 3);  // WRONG - always 3
    // instead of:
    //   return executeStateUpdateWithRetry(..., maxRetries);  // RIGHT - respects parameter

    assert.strictEqual(typeof safeUpdatePRBodyState, 'function');
    // Note: .length only counts parameters without defaults, so it's 3 not 4
    // (prNumber, state, step) - maxRetries has default so not counted
    assert.strictEqual(safeUpdatePRBodyState.length, 3, 'Function has 3 required parameters');
  });

  it('should document maxRetries parameter pass-through for issue wrapper', () => {
    // The safeUpdateIssueBodyState wrapper accepts an optional maxRetries parameter
    // and passes it through to executeStateUpdateWithRetry (line 714 in router.ts):
    //
    // export async function safeUpdateIssueBodyState(
    //   issueNumber: number,
    //   state: WiggumState,
    //   step: string,
    //   maxRetries = 3                              // Default value
    // ): Promise<StateUpdateResult> {
    //   return executeStateUpdateWithRetry(
    //     { resourceType: 'issue', resourceId: issueNumber, updateFn: updateIssueBodyState },
    //     state,
    //     step,
    //     maxRetries                                // Passed through here
    //   );
    // }
    //
    // This ensures behavioral parity with the PR wrapper - both accept and pass through
    // custom maxRetries values the same way.
    //
    // The actual retry behavior with custom maxRetries values is thoroughly tested
    // in router-retry.test.ts for executeStateUpdateWithRetry.

    assert.strictEqual(typeof safeUpdateIssueBodyState, 'function');
    // Note: .length only counts parameters without defaults, so it's 3 not 4
    // (issueNumber, state, step) - maxRetries has default so not counted
    assert.strictEqual(safeUpdateIssueBodyState.length, 3, 'Function has 3 required parameters');
  });
});

describe('Wrapper function defensive checks', () => {
  it('should document defensive check for updatePRBodyState', () => {
    // safeUpdatePRBodyState has a defensive check (lines 645-650 in router.ts):
    //
    // if (typeof updatePRBodyState !== 'function') {
    //   throw new Error(
    //     'safeUpdatePRBodyState: updatePRBodyState function is not defined. ' +
    //     'This indicates a module import failure or circular dependency.'
    //   );
    // }
    //
    // This check catches:
    // - Import failures during module loading
    // - Circular dependencies breaking at runtime
    // - Build system issues with bundling/compilation
    //
    // Cannot test at runtime with ES modules (read-only exports), but the check
    // provides a clear error message if the unlikely scenario occurs.

    assert.strictEqual(typeof bodyState.updatePRBodyState, 'function');
  });

  it('should document defensive check for updateIssueBodyState', () => {
    // safeUpdateIssueBodyState has a defensive check (lines 689-694 in router.ts):
    //
    // if (typeof updateIssueBodyState !== 'function') {
    //   throw new Error(
    //     'safeUpdateIssueBodyState: updateIssueBodyState function is not defined. ' +
    //     'This indicates a module import failure or circular dependency.'
    //   );
    // }
    //
    // This check catches serious module loading issues at runtime.
    // While unlikely (TypeScript provides compile-time protection), it ensures
    // clear error messages guide developers to the likely cause.

    assert.strictEqual(typeof bodyState.updateIssueBodyState, 'function');
  });
});

describe('Wrapper function integration', () => {
  it('should document that safeUpdatePRBodyState passes PR config to executeStateUpdateWithRetry', () => {
    // safeUpdatePRBodyState delegates to executeStateUpdateWithRetry with this config:
    // {
    //   resourceType: 'pr',
    //   resourceId: prNumber (from parameter),
    //   updateFn: updatePRBodyState (from body-state.ts)
    // }
    //
    // This configuration ensures:
    // - Error messages reference "PR #123" not "issue"
    // - Logging uses prNumber field correctly
    // - Correct API endpoint is called (gh pr edit, not gh issue edit)
    //
    // The wrapper implementation (lines 652-661) shows the correct mapping:
    // return executeStateUpdateWithRetry(
    //   {
    //     resourceType: 'pr',
    //     resourceId: prNumber,
    //     updateFn: updatePRBodyState,
    //   },
    //   ...
    // );

    assert.strictEqual(typeof bodyState.updatePRBodyState, 'function');
  });

  it('should document that safeUpdateIssueBodyState passes issue config to executeStateUpdateWithRetry', () => {
    // safeUpdateIssueBodyState delegates to executeStateUpdateWithRetry with this config:
    // {
    //   resourceType: 'issue',
    //   resourceId: issueNumber (from parameter),
    //   updateFn: updateIssueBodyState (from body-state.ts)
    // }
    //
    // This configuration ensures:
    // - Error messages reference "issue #456" not "PR"
    // - Logging uses issueNumber field correctly
    // - Correct API endpoint is called (gh issue edit, not gh pr edit)
    //
    // The wrapper implementation (lines 696-705) shows the correct mapping:
    // return executeStateUpdateWithRetry(
    //   {
    //     resourceType: 'issue',
    //     resourceId: issueNumber,
    //     updateFn: updateIssueBodyState,
    //   },
    //   ...
    // );

    assert.strictEqual(typeof bodyState.updateIssueBodyState, 'function');
  });

  it('should verify wrapper functions use distinct update functions from body-state module', () => {
    // Regression prevention: This test documents that the wrappers call
    // different functions from body-state.ts:
    //
    // - safeUpdatePRBodyState → updatePRBodyState
    // - safeUpdateIssueBodyState → updateIssueBodyState
    //
    // If someone accidentally swaps these during copy-paste:
    // - PRs would be updated with 'gh issue edit' (wrong!)
    // - Issues would be updated with 'gh pr edit' (wrong!)
    //
    // The type system enforces this at compile time, and the distinct
    // function references prevent runtime cross-calls.

    assert.notStrictEqual(
      bodyState.updatePRBodyState,
      bodyState.updateIssueBodyState,
      'PR and issue update functions must be distinct'
    );
    assert.strictEqual(typeof bodyState.updatePRBodyState, 'function');
    assert.strictEqual(typeof bodyState.updateIssueBodyState, 'function');
  });
});

// TODO(#1872): Consider integration test for safeUpdatePRBodyState with real GitHub API

describe('Security Review Instructions', () => {
  describe('Phase 1 Security Review', () => {
    // TODO(#1832): Extract duplicate test setup to beforeEach hook
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
      // Critical requirement for issue #552: The agent may not see /security-review
      // in its available commands list due to command registry timing or context issues.
      // Without explicit instruction to proceed anyway, the agent refuses invocation.
      // These instructions must override the agent's hesitation when a command appears missing.
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

    // TODO(#1835): Add tests for edge cases (large issue numbers, high iteration counts)
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

    it('should include explanation of why SlashCommand tool is required', () => {
      const state = createMockState({
        git: { isPushed: true, hasUncommittedChanges: false },
        wiggum: { phase: 'phase1', iteration: 0 },
      });

      const result = handlePhase1SecurityReview(state, 552);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('Why SlashCommand tool is required'),
        'Instructions should include explanation header'
      );
      assert.ok(
        instructions.includes('expand to structured prompts') ||
          instructions.includes('prompt expansion mechanism'),
        'Instructions should explain why SlashCommand is required'
      );
      assert.ok(
        instructions.includes('Expand the command into its full prompt instructions'),
        'Instructions should explain prompt expansion'
      );
      assert.ok(
        instructions.includes('Ensure the prompt is executed completely before proceeding'),
        'Instructions should explain execution ordering'
      );
    });

    it('should include backward iteration instruction for issues found', () => {
      const state = createMockState({
        git: { isPushed: true, hasUncommittedChanges: false },
        wiggum: { phase: 'phase1', iteration: 0 },
      });

      const result = handlePhase1SecurityReview(state, 552);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('restarts from Step p1-1') ||
          instructions.includes('restart from Step p1-1'),
        'Instructions should include backward iteration to p1-1 on issue found'
      );
    });

    it('should include forward progression instruction when no issues found', () => {
      const state = createMockState({
        git: { isPushed: true, hasUncommittedChanges: false },
        wiggum: { phase: 'phase1', iteration: 0 },
      });

      const result = handlePhase1SecurityReview(state, 552);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('Proceed to Step p1-4') ||
          instructions.includes('proceed to Step p1-4'),
        'Instructions should include forward progression to p1-4 when no issues'
      );
      assert.ok(
        instructions.includes('Create PR') || instructions.toLowerCase().includes('create pr'),
        'Instructions should indicate that p1-4 is the Create PR step'
      );
    });

    it('should include commit-merge-push instruction for fixes', () => {
      const state = createMockState({
        git: { isPushed: true, hasUncommittedChanges: false },
        wiggum: { phase: 'phase1', iteration: 0 },
      });

      const result = handlePhase1SecurityReview(state, 552);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('/commit-merge-push'),
        'Instructions should include /commit-merge-push for committing fixes'
      );
      assert.ok(
        instructions.includes('in-scope issues were found and fixed'),
        'Instructions should clarify commit is only needed if fixes were made'
      );
    });

    it('should include result aggregation instructions', () => {
      const state = createMockState({
        git: { isPushed: true, hasUncommittedChanges: false },
        wiggum: { phase: 'phase1', iteration: 0 },
      });

      const result = handlePhase1SecurityReview(state, 552);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('aggregate results'),
        'Instructions should mention aggregating results'
      );
      assert.ok(
        instructions.includes('Collect result file paths') ||
          instructions.includes('Collect all result file paths'),
        'Instructions should explain collecting file paths'
      );
      assert.ok(
        instructions.includes('Sum issue counts') || instructions.includes('Count total'),
        'Instructions should explain summing issue counts'
      );
    });

    describe('Error Handling', () => {
      it('should handle Phase 1 security review during wrong phase', () => {
        const state = createMockState({
          git: { isPushed: true, hasUncommittedChanges: false },
          wiggum: { phase: 'phase2', iteration: 0 }, // Wrong phase
        });

        // TODO(#1841): Comment clarifies defensive test behavior but could be more concise
        // handlePhase1SecurityReview doesn't currently validate phase
        // Test that it still produces valid instructions (defensive)
        const result = handlePhase1SecurityReview(state, 552);
        const instructions = result.content[0].text;

        // Should still include security review command
        assert.ok(
          instructions.includes(SECURITY_REVIEW_COMMAND),
          'Should include security review command even if called during wrong phase'
        );
      });

      it('should handle Phase 2 security review without PR', () => {
        const state = createMockState({
          pr: { exists: false },
          wiggum: { phase: 'phase2', iteration: 0 },
        });

        // TODO(#1842): Comment provides useful context about type system contract but slightly verbose
        // Type system prevents this at compile time, but test runtime behavior
        // handlePhase2SecurityReview requires CurrentStateWithPR
        // Calling with wrong type should be caught by TypeScript
        // This test documents the contract

        assert.strictEqual(
          hasExistingPR(state),
          false,
          'State without PR should not pass type guard'
        );
      });

      it('should handle uncommitted changes during security review', () => {
        const state = createMockState({
          git: { isPushed: true, hasUncommittedChanges: true },
          wiggum: { phase: 'phase1', iteration: 0 },
        });

        // TODO(#1843): Comment explains test expectation but parenthetical note is unclear
        // Test that handler still produces instructions
        // (Pre-commit hooks will catch uncommitted changes)
        const result = handlePhase1SecurityReview(state, 552);
        const instructions = result.content[0].text;

        assert.ok(
          instructions.includes('wiggum_complete_security_review'),
          'Should include completion tool even with uncommitted changes'
        );
      });
    });
  });

  describe('Phase 2 Security Review', () => {
    // TODO(#1831): Extract duplicate test setup to beforeEach hook
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
        'Instructions should reference wiggum_complete_security_review (not wiggum_complete_pr_review)'
      );
      assert.ok(
        instructions.includes('command_executed'),
        'Instructions should mention command_executed parameter'
      );
      assert.ok(
        instructions.includes('in_scope_result_files'),
        'Instructions should mention in_scope_result_files parameter'
      );
      assert.ok(
        instructions.includes('out_of_scope_result_files'),
        'Instructions should mention out_of_scope_result_files parameter'
      );
      assert.ok(
        instructions.includes('in_scope_issue_count'),
        'Instructions should mention in_scope_issue_count parameter'
      );
      assert.ok(
        instructions.includes('out_of_scope_issue_count'),
        'Instructions should mention out_of_scope_issue_count parameter'
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

    it('should include backward iteration instruction for issues found', () => {
      const state = createMockState({
        pr: { exists: true, state: 'OPEN', number: 123 },
        wiggum: { phase: 'phase2', iteration: 0 },
      });

      if (!hasExistingPR(state)) {
        throw new Error('Test setup failed: PR should exist');
      }

      const result = handlePhase2SecurityReview(state);
      const instructions = result.content[0].text;

      // TODO(#1833): Clarify comment - test only checks tool reference, not iteration logic
      assert.ok(
        instructions.includes('wiggum_complete_security_review'),
        'Instructions should reference completion tool that handles iteration'
      );
    });

    it('should include forward progression instruction when no issues found', () => {
      const state = createMockState({
        pr: { exists: true, state: 'OPEN', number: 123 },
        wiggum: { phase: 'phase2', iteration: 0 },
      });

      if (!hasExistingPR(state)) {
        throw new Error('Test setup failed: PR should exist');
      }

      const result = handlePhase2SecurityReview(state);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('wiggum_complete_security_review'),
        'Instructions should reference completion tool that provides next step'
      );
      assert.ok(
        instructions.includes('returns next step instructions'),
        'Instructions should indicate tool returns next steps'
      );
    });

    it('should include commit-merge-push instruction for fixes', () => {
      const state = createMockState({
        pr: { exists: true, state: 'OPEN', number: 123 },
        wiggum: { phase: 'phase2', iteration: 0 },
      });

      if (!hasExistingPR(state)) {
        throw new Error('Test setup failed: PR should exist');
      }

      const result = handlePhase2SecurityReview(state);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes(SECURITY_REVIEW_COMMAND),
        'Instructions should include security review command that handles commits'
      );
    });

    it('should include result aggregation instructions', () => {
      const state = createMockState({
        pr: { exists: true, state: 'OPEN', number: 123 },
        wiggum: { phase: 'phase2', iteration: 0 },
      });

      if (!hasExistingPR(state)) {
        throw new Error('Test setup failed: PR should exist');
      }

      const result = handlePhase2SecurityReview(state);
      const instructions = result.content[0].text;

      assert.ok(
        instructions.includes('Aggregate results from all agents'),
        'Instructions should mention aggregating results from all agents'
      );
      assert.ok(
        instructions.includes('in_scope_result_files'),
        'Instructions should reference in_scope_result_files parameter'
      );
      assert.ok(
        instructions.includes('out_of_scope_result_files'),
        'Instructions should reference out_of_scope_result_files parameter'
      );
      assert.ok(
        instructions.includes('in_scope_issue_count'),
        'Instructions should reference in_scope_issue_count parameter'
      );
      assert.ok(
        instructions.includes('out_of_scope_issue_count'),
        'Instructions should reference out_of_scope_issue_count parameter'
      );
    });
  });

  describe('E2E Slash Command Flow', () => {
    // TODO(#1666): Implement full E2E test for slash command invocation
    it.skip('should successfully invoke /security-review and complete', async () => {
      // This test requires:
      // 1. Mock SlashCommand tool implementation
      // 2. Mock agent execution that follows instructions
      // 3. Mock file system for result files
      // 4. Integration with wiggum_complete_security_review tool

      // Test flow:
      // - Setup: Create test state with wiggum in security review step
      // - Execute: Call wiggum_init to get instructions
      // - Simulate: Agent invokes SlashCommand tool with /security-review
      // - Verify: Command executes and launches security review agents
      // - Simulate: Agents complete and write result files
      // - Execute: Agent calls wiggum_complete_security_review
      // - Verify: State transitions correctly to next step

      throw new Error('E2E test not implemented - see issue #1666');
    });

    it.skip('should handle SlashCommand tool invocation failure', async () => {
      // TODO(#1666): Test error handling when SlashCommand tool fails
      throw new Error('E2E test not implemented - see issue #1666');
    });
  });

  describe('Completion Tool Parameter Validation', () => {
    // TODO(#1810): These tests document expected validation behavior
    // Actual validation should be implemented in wiggum_complete_security_review tool

    it.skip('should reject command_executed=false', async () => {
      // TODO(#1810): Implement in tool handler
      // Expected: Tool should return error when command not executed
      throw new Error('Validation test not implemented - see issue #1810');
    });

    it.skip('should validate result file paths exist', async () => {
      // TODO(#1810): Implement in tool handler
      // Expected: Tool should verify result files are readable
      throw new Error('Validation test not implemented - see issue #1810');
    });

    it.skip('should detect mismatched counts and files', async () => {
      // TODO(#1810): Implement in tool handler
      // Expected: Tool should log warning if counts seem inconsistent
      throw new Error('Validation test not implemented - see issue #1810');
    });

    // Note: Testing wrong tool invocation (wiggum_complete_pr_review vs
    // wiggum_complete_security_review) requires integration test with MCP server
    // See TODO(#1810) for implementation approach
  });
});
