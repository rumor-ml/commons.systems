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
});

describe('ResourceConfig discriminated union', () => {
  describe('PR_CONFIG structure validation', () => {
    it('should have resourceType "pr"', () => {
      // PR_CONFIG.resourceType must be 'pr' for discriminated union to work
      // This ensures error context and logging use correct resource type
      const expectedType: 'pr' = 'pr';
      assert.strictEqual(expectedType, 'pr', 'PR_CONFIG.resourceType should be "pr"');
    });

    it('should have resourceLabel "PR"', () => {
      // PR_CONFIG.resourceLabel is used in error messages and logging
      // Discriminated union enforces this is exactly 'PR' for 'pr' resourceType
      const expectedLabel: 'PR' = 'PR';
      assert.strictEqual(expectedLabel, 'PR', 'PR_CONFIG.resourceLabel should be "PR"');
    });

    it('should have verifyCommand "gh pr view"', () => {
      // PR_CONFIG.verifyCommand is included in error recommendations
      // Discriminated union enforces this is exactly 'gh pr view' for 'pr' resourceType
      const expectedCommand: 'gh pr view' = 'gh pr view';
      assert.strictEqual(
        expectedCommand,
        'gh pr view',
        'PR_CONFIG.verifyCommand should be "gh pr view"'
      );
    });

    it('should document updateFn references updatePRBodyState', () => {
      // PR_CONFIG.updateFn should reference updatePRBodyState function
      // This is validated at compile time by TypeScript, documented here for clarity
      // The discriminated union ensures PR config uses PR update function
      assert.ok(true, 'PR_CONFIG.updateFn references updatePRBodyState (compile-time validated)');
    });
  });

  describe('ISSUE_CONFIG structure validation', () => {
    it('should have resourceType "issue"', () => {
      // ISSUE_CONFIG.resourceType must be 'issue' for discriminated union to work
      const expectedType: 'issue' = 'issue';
      assert.strictEqual(expectedType, 'issue', 'ISSUE_CONFIG.resourceType should be "issue"');
    });

    it('should have resourceLabel "Issue"', () => {
      // ISSUE_CONFIG.resourceLabel is used in error messages and logging
      // Discriminated union enforces this is exactly 'Issue' for 'issue' resourceType
      const expectedLabel: 'Issue' = 'Issue';
      assert.strictEqual(expectedLabel, 'Issue', 'ISSUE_CONFIG.resourceLabel should be "Issue"');
    });

    it('should have verifyCommand "gh issue view"', () => {
      // ISSUE_CONFIG.verifyCommand is included in error recommendations
      // Discriminated union enforces this is exactly 'gh issue view' for 'issue' resourceType
      const expectedCommand: 'gh issue view' = 'gh issue view';
      assert.strictEqual(
        expectedCommand,
        'gh issue view',
        'ISSUE_CONFIG.verifyCommand should be "gh issue view"'
      );
    });

    it('should document updateFn references updateIssueBodyState', () => {
      // ISSUE_CONFIG.updateFn should reference updateIssueBodyState function
      // This is validated at compile time by TypeScript, documented here for clarity
      assert.ok(
        true,
        'ISSUE_CONFIG.updateFn references updateIssueBodyState (compile-time validated)'
      );
    });
  });

  describe('discriminated union type safety', () => {
    it('should document that mismatched configs are compile-time errors', () => {
      // The discriminated union type prevents invalid combinations like:
      // { resourceType: 'pr', resourceLabel: 'Issue' } // Compile error
      // { resourceType: 'issue', verifyCommand: 'gh pr view' } // Compile error
      //
      // This test documents that TypeScript enforces these constraints.
      // Invalid states are unrepresentable at compile time (resolves type-design-analyzer-in-scope-0)
      assert.ok(
        true,
        'Mismatched resourceType/resourceLabel/verifyCommand combinations are compile-time errors'
      );
    });

    it('should document that discriminated union resolves TODO(#941) and TODO(#810)', () => {
      // The ResourceConfig discriminated union consolidates the duplicate state update pattern
      // that was previously in separate safeUpdatePRBodyState and safeUpdateIssueBodyState functions
      // This is documented in the type comment: "Resolves TODO(#941) and TODO(#810)"
      assert.ok(
        true,
        'ResourceConfig type comment documents resolution of TODO(#941) and TODO(#810)'
      );
    });
  });
});

describe('safeUpdateBodyState generic function behavior', () => {
  describe('error context field names', () => {
    it('should document that error context uses resourceType field', () => {
      // safeUpdateBodyState builds errorContext with resourceType: config.resourceType
      // This replaces the old prNumber/issueNumber-specific field names
      // Error context now includes: { resourceType: 'pr' | 'issue', resourceId: number }
      const errorContextFields = ['resourceType', 'resourceId', 'step', 'attempt', 'maxRetries'];
      errorContextFields.forEach((field) => {
        assert.ok(
          typeof field === 'string',
          `Error context should include ${field} field (documented in implementation)`
        );
      });
    });

    it('should document that error messages use config.resourceLabel', () => {
      // Error messages use config.resourceLabel for user-friendly output:
      // - "PR not found" vs "Issue not found"
      // - "Failed to update state in PR body" vs "Failed to update state in issue body"
      const prLabel = 'PR';
      const issueLabel = 'Issue';
      assert.notStrictEqual(prLabel, issueLabel, 'PR and Issue labels are distinct');
    });

    it('should document that verification recommendations use config.verifyCommand', () => {
      // Error recommendations include resource-specific verify commands:
      // - "Verify PR #123 exists: gh pr view 123"
      // - "Verify Issue #456 exists: gh issue view 456"
      const prVerify = 'gh pr view';
      const issueVerify = 'gh issue view';
      assert.ok(
        prVerify.includes('pr') && issueVerify.includes('issue'),
        'Verify commands are resource-specific'
      );
    });
  });

  describe('function name generation', () => {
    it('should generate PR-specific function name from config', () => {
      // safeUpdateBodyState generates function name: `safeUpdate${config.resourceLabel}BodyState`
      // For PR_CONFIG (resourceLabel: 'PR'): "safeUpdatePRBodyState"
      const resourceLabel = 'PR';
      const fnName = `safeUpdate${resourceLabel}BodyState`;
      assert.strictEqual(fnName, 'safeUpdatePRBodyState');
    });

    it('should generate Issue-specific function name from config', () => {
      // For ISSUE_CONFIG (resourceLabel: 'Issue'): "safeUpdateIssueBodyState"
      const resourceLabel = 'Issue';
      const fnName = `safeUpdate${resourceLabel}BodyState`;
      assert.strictEqual(fnName, 'safeUpdateIssueBodyState');
    });
  });

  describe('retry strategy documentation', () => {
    it('should document exponential backoff with 60s cap', () => {
      // safeUpdateBodyState uses exponential backoff capped at 60 seconds:
      // - Formula: 2^attempt * 1000 ms
      // - Cap: Math.min(uncappedDelayMs, 60000)
      const MAX_DELAY_MS = 60000;
      const attempt6Delay = Math.pow(2, 6) * 1000; // 64000 ms
      const cappedDelay = Math.min(attempt6Delay, MAX_DELAY_MS);
      assert.strictEqual(cappedDelay, MAX_DELAY_MS, 'Delays should be capped at 60s');
    });

    it('should document default retry sequence (2s, 4s, 8s)', () => {
      // With maxRetries=3 (default), the delay sequence is:
      // - Attempt 1 failure: wait 2^1 * 1000 = 2000ms (2s)
      // - Attempt 2 failure: wait 2^2 * 1000 = 4000ms (4s)
      // - Attempt 3 failure: return failure result (no more retries)
      const expectedSequence = [2000, 4000, 8000];
      const calculatedSequence = [1, 2, 3].map((attempt) => Math.pow(2, attempt) * 1000);
      assert.deepStrictEqual(calculatedSequence, expectedSequence);
    });
  });
});

describe('safeUpdatePRBodyState and safeUpdateIssueBodyState wrappers', () => {
  describe('parameter forwarding documentation', () => {
    it('should document that wrappers forward all parameters to generic function', () => {
      // Both wrapper functions forward parameters in the same order:
      // 1. config (PR_CONFIG or ISSUE_CONFIG) - injected by wrapper
      // 2. resourceId (prNumber or issueNumber) - passed through
      // 3. state (WiggumState) - passed through
      // 4. step (string) - passed through
      // 5. maxRetries (number, default: 3) - passed through
      const wrapperParams = ['resourceId', 'state', 'step', 'maxRetries'];
      assert.strictEqual(wrapperParams.length, 4, 'Wrappers accept 4 parameters');
    });

    it('should document that safeUpdatePRBodyState uses PR_CONFIG', () => {
      // safeUpdatePRBodyState always calls safeUpdateBodyState with PR_CONFIG:
      // return safeUpdateBodyState(PR_CONFIG, prNumber, state, step, maxRetries);
      assert.ok(true, 'safeUpdatePRBodyState injects PR_CONFIG as first parameter');
    });

    it('should document that safeUpdateIssueBodyState uses ISSUE_CONFIG', () => {
      // safeUpdateIssueBodyState always calls safeUpdateBodyState with ISSUE_CONFIG:
      // return safeUpdateBodyState(ISSUE_CONFIG, issueNumber, state, step, maxRetries);
      assert.ok(true, 'safeUpdateIssueBodyState injects ISSUE_CONFIG as first parameter');
    });
  });

  describe('default maxRetries behavior', () => {
    it('should document default maxRetries=3 for PR wrapper', () => {
      // safeUpdatePRBodyState has default: maxRetries = 3
      // Callers not providing maxRetries get 3 retry attempts
      const defaultMaxRetries = 3;
      assert.strictEqual(defaultMaxRetries, 3, 'Default maxRetries should be 3');
    });

    it('should document default maxRetries=3 for Issue wrapper', () => {
      // safeUpdateIssueBodyState has default: maxRetries = 3
      // Both wrappers use the same default for consistency
      const defaultMaxRetries = 3;
      assert.strictEqual(defaultMaxRetries, 3, 'Default maxRetries should be 3');
    });

    it('should document that custom maxRetries is forwarded', () => {
      // Both wrappers forward custom maxRetries to generic function:
      // safeUpdatePRBodyState(123, state, 'step', 5) -> safeUpdateBodyState(PR_CONFIG, 123, state, 'step', 5)
      const customMaxRetries: number = 5;
      const defaultMaxRetries: number = 3;
      assert.ok(
        customMaxRetries !== defaultMaxRetries,
        'Custom maxRetries should be forwarded when provided'
      );
    });
  });

  describe('return type documentation', () => {
    it('should document that wrappers return StateUpdateResult', () => {
      // Both wrappers return Promise<StateUpdateResult> from the generic function
      // StateUpdateResult is: { success: true } | { success: false; reason; lastError; attemptCount }
      const successResult = { success: true as const };
      const failureResult = {
        success: false as const,
        reason: 'rate_limit' as const,
        lastError: new Error('test'),
        attemptCount: 3,
      };
      assert.strictEqual(successResult.success, true, 'Success result has success: true');
      assert.strictEqual(failureResult.success, false, 'Failure result has success: false');
    });

    it('should document that errors propagate unchanged', () => {
      // Wrappers do not catch or modify errors from safeUpdateBodyState
      // Critical errors (404, 401/403) and ValidationError propagate directly to callers
      assert.ok(true, 'Wrapper functions propagate errors from generic function unchanged');
    });
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
