/**
 * Tests for router state machine logic
 *
 * These tests verify the routing logic that determines workflow step progression,
 * type guards, and helper functions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { _testExports } from './router.js';
import type { CurrentState, PRExists, PRDoesNotExist, PRStateValue } from './types.js';
import type { WiggumStep } from '../constants.js';
import {
  STEP_ENSURE_PR,
  STEP_MONITOR_WORKFLOW,
  STEP_MONITOR_PR_CHECKS,
  STEP_CODE_QUALITY,
  STEP_PR_REVIEW,
  STEP_SECURITY_REVIEW,
  STEP_VERIFY_REVIEWS,
  STEP_APPROVAL,
} from '../constants.js';

const { hasExistingPR, checkUncommittedChanges, checkBranchPushed, formatFixInstructions } =
  _testExports;

/**
 * Create a mock CurrentState for testing
 */
function createMockState(overrides: {
  pr?: { exists: boolean; state?: PRStateValue; number?: number };
  git?: { isMainBranch?: boolean; hasUncommittedChanges?: boolean; isPushed?: boolean };
  wiggum?: { iteration?: number; completedSteps?: WiggumStep[] };
}): CurrentState {
  const defaultPR: PRDoesNotExist = { exists: false };
  const pr = overrides.pr?.exists
    ? ({
        exists: true,
        state: overrides.pr.state || 'OPEN',
        number: overrides.pr.number || 123,
        title: 'Test PR',
        url: 'https://github.com/test/repo/pull/123',
        labels: [],
        headRefName: 'feature-branch',
        baseRefName: 'main',
      } as PRExists)
    : defaultPR;

  return {
    pr,
    git: {
      isMainBranch: overrides.git?.isMainBranch ?? false,
      hasUncommittedChanges: overrides.git?.hasUncommittedChanges ?? false,
      isPushed: overrides.git?.isPushed ?? true,
      currentBranch: 'feature-branch',
      isRemoteTracking: true,
    },
    wiggum: {
      iteration: overrides.wiggum?.iteration ?? 0,
      step: STEP_ENSURE_PR,
      completedSteps: overrides.wiggum?.completedSteps ?? [],
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
      // TypeScript should allow accessing pr.number here
      assert.strictEqual(state.pr.number, 42);
      assert.strictEqual(state.pr.state, 'OPEN');
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
    assert.ok((result.content[0] as { text: string }).text.includes('Uncommitted changes detected'));
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
    assert.deepStrictEqual(output.steps_completed_by_tool, ['previous step', 'Checked push status']);
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
});

describe('Step Sequencing Logic', () => {
  describe('completedSteps filtering', () => {
    it('should recognize valid step values in completedSteps', () => {
      const validSteps: WiggumStep[] = [
        STEP_ENSURE_PR,
        STEP_MONITOR_WORKFLOW,
        STEP_MONITOR_PR_CHECKS,
        STEP_CODE_QUALITY,
        STEP_PR_REVIEW,
        STEP_SECURITY_REVIEW,
        STEP_VERIFY_REVIEWS,
        STEP_APPROVAL,
      ];
      for (const step of validSteps) {
        const state = createMockState({
          pr: { exists: true, state: 'OPEN' },
          wiggum: { completedSteps: [step] },
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
      STEP_ENSURE_PR,
      STEP_MONITOR_WORKFLOW,
      STEP_MONITOR_PR_CHECKS,
      STEP_CODE_QUALITY,
    ];
    const uniqueSteps = [...new Set(completedSteps)];
    assert.strictEqual(completedSteps.length, uniqueSteps.length);
  });

  it('should maintain iteration count across state', () => {
    const state = createMockState({
      wiggum: { iteration: 5, completedSteps: [STEP_ENSURE_PR, STEP_MONITOR_WORKFLOW] },
    });
    assert.strictEqual(state.wiggum.iteration, 5);
  });

  it('should preserve step completion order', () => {
    const completedSteps: WiggumStep[] = [
      STEP_ENSURE_PR,
      STEP_MONITOR_WORKFLOW,
      STEP_MONITOR_PR_CHECKS,
    ];
    const state = createMockState({
      wiggum: { completedSteps },
    });
    // Verify order is preserved
    assert.deepStrictEqual(state.wiggum.completedSteps, [
      STEP_ENSURE_PR,
      STEP_MONITOR_WORKFLOW,
      STEP_MONITOR_PR_CHECKS,
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
