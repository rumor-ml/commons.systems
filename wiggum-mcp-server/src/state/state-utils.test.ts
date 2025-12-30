/**
 * Tests for state-utils.ts - state management utility functions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getTargetNumber,
  formatLocation,
  getEffectiveMaxIterations,
  isIterationLimitReached,
} from './state-utils.js';
import { ValidationError } from '../utils/errors.js';
import { DEFAULT_MAX_ITERATIONS, STEP_PHASE1_MONITOR_WORKFLOW } from '../constants.js';
import type { WiggumPhase } from '../constants.js';
import type { CurrentState, WiggumState } from './types.js';

/**
 * Create a minimal CurrentState for testing
 * All fields are properly typed to satisfy CurrentState interface
 */
function createTestCurrentState(overrides: {
  issueExists?: boolean;
  issueNumber?: number;
  prExists?: boolean;
  prNumber?: number;
  currentBranch?: string;
}): CurrentState {
  const {
    issueExists = false,
    issueNumber,
    prExists = false,
    prNumber,
    currentBranch = 'test-branch',
  } = overrides;

  return {
    git: {
      currentBranch,
      isMainBranch: false,
      hasUncommittedChanges: false,
      isRemoteTracking: true,
      isPushed: true,
    },
    pr: prExists
      ? {
          exists: true,
          number: prNumber!,
          title: 'Test PR',
          state: 'OPEN' as const,
          url: `https://github.com/test/repo/pull/${prNumber}`,
          labels: [],
          headRefName: currentBranch,
          baseRefName: 'main',
        }
      : { exists: false },
    issue: issueExists ? { exists: true, number: issueNumber! } : { exists: false },
    wiggum: {
      iteration: 0,
      step: STEP_PHASE1_MONITOR_WORKFLOW,
      completedSteps: [],
      phase: 'phase1' as WiggumPhase,
    },
  };
}

/**
 * Create a minimal WiggumState for testing
 */
function createTestWiggumState(overrides: {
  iteration?: number;
  maxIterations?: number;
}): WiggumState {
  const { iteration = 0, maxIterations } = overrides;

  return {
    iteration,
    step: STEP_PHASE1_MONITOR_WORKFLOW,
    completedSteps: [],
    phase: 'phase1' as WiggumPhase,
    maxIterations,
  };
}

describe('getTargetNumber', () => {
  describe('phase1 (pre-PR)', () => {
    it('should return issue number when issue exists in phase1', () => {
      const state = createTestCurrentState({
        issueExists: true,
        issueNumber: 123,
      });

      const result = getTargetNumber(state, 'phase1', 'test_tool');

      assert.strictEqual(result, 123);
    });

    it('should throw ValidationError when issue does not exist in phase1', () => {
      const state = createTestCurrentState({
        issueExists: false,
        currentBranch: 'feature-without-issue',
      });

      assert.throws(
        () => getTargetNumber(state, 'phase1', 'test_tool'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('No issue found'));
          assert(err.message.includes('Phase 1 requires an issue number'));
          assert(err.message.includes('feature-without-issue'));
          assert(err.message.includes('Expected format: 123-feature-name'));
          return true;
        }
      );
    });

    it('should include helpful remediation steps in phase1 error', () => {
      const state = createTestCurrentState({
        issueExists: false,
        currentBranch: 'my-random-branch',
      });

      assert.throws(
        () => getTargetNumber(state, 'phase1', 'wiggum_init'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes("Ensure you're working on an issue-based branch"));
          assert(err.message.includes('Branch name must start with the issue number'));
          assert(err.message.includes('git checkout -b 282-my-feature'));
          return true;
        }
      );
    });
  });

  describe('phase2 (post-PR)', () => {
    it('should return PR number when PR exists in phase2', () => {
      const state = createTestCurrentState({
        prExists: true,
        prNumber: 456,
      });

      const result = getTargetNumber(state, 'phase2', 'test_tool');

      assert.strictEqual(result, 456);
    });

    it('should throw ValidationError when PR does not exist in phase2', () => {
      const state = createTestCurrentState({
        prExists: false,
        currentBranch: '789-feature-branch',
      });

      assert.throws(
        () => getTargetNumber(state, 'phase2', 'test_tool'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('No PR found'));
          assert(err.message.includes('Phase 2 requires an open pull request'));
          assert(err.message.includes('789-feature-branch'));
          return true;
        }
      );
    });

    it('should include helpful remediation steps in phase2 error', () => {
      const state = createTestCurrentState({
        prExists: false,
        currentBranch: '123-my-feature',
      });

      assert.throws(
        () => getTargetNumber(state, 'phase2', 'wiggum_complete_all_hands'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('gh pr create'));
          assert(err.message.includes('wiggum_complete_pr_creation'));
          assert(err.message.includes('gh pr view'));
          return true;
        }
      );
    });
  });

  describe('unknown phase', () => {
    it('should throw ValidationError for unknown phase', () => {
      const state = createTestCurrentState({
        issueExists: true,
        issueNumber: 123,
        prExists: true,
        prNumber: 456,
      });

      assert.throws(
        () => getTargetNumber(state, 'phase3' as WiggumPhase, 'test_tool'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Unknown phase: phase3'));
          assert(err.message.includes("Expected 'phase1' or 'phase2'"));
          assert(err.message.includes('workflow state corruption'));
          return true;
        }
      );
    });

    it('should throw ValidationError for empty phase', () => {
      const state = createTestCurrentState({
        issueExists: true,
        issueNumber: 123,
      });

      assert.throws(
        () => getTargetNumber(state, '' as WiggumPhase, 'test_tool'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Unknown phase'));
          return true;
        }
      );
    });
  });
});

describe('formatLocation', () => {
  it('should return "issue #N" for phase1', () => {
    const result = formatLocation('phase1', 123);

    assert.strictEqual(result, 'issue #123');
  });

  it('should return "PR #N" for phase2', () => {
    const result = formatLocation('phase2', 456);

    assert.strictEqual(result, 'PR #456');
  });

  it('should handle large numbers correctly', () => {
    assert.strictEqual(formatLocation('phase1', 999999), 'issue #999999');
    assert.strictEqual(formatLocation('phase2', 100000), 'PR #100000');
  });

  it('should handle single digit numbers correctly', () => {
    assert.strictEqual(formatLocation('phase1', 1), 'issue #1');
    assert.strictEqual(formatLocation('phase2', 9), 'PR #9');
  });
});

describe('getEffectiveMaxIterations', () => {
  it('should return custom maxIterations when set', () => {
    const state = createTestWiggumState({ maxIterations: 15 });

    const result = getEffectiveMaxIterations(state);

    assert.strictEqual(result, 15);
  });

  it('should return default when maxIterations is undefined', () => {
    const state = createTestWiggumState({ maxIterations: undefined });

    const result = getEffectiveMaxIterations(state);

    assert.strictEqual(result, DEFAULT_MAX_ITERATIONS);
    assert.strictEqual(result, 10); // Verify the constant value
  });

  it('should return custom value of 1', () => {
    const state = createTestWiggumState({ maxIterations: 1 });

    const result = getEffectiveMaxIterations(state);

    assert.strictEqual(result, 1);
  });

  it('should return large custom values', () => {
    const state = createTestWiggumState({ maxIterations: 100 });

    const result = getEffectiveMaxIterations(state);

    assert.strictEqual(result, 100);
  });
});

describe('isIterationLimitReached', () => {
  describe('with default limit', () => {
    it('should return false when iteration is below limit', () => {
      const state = createTestWiggumState({ iteration: 5 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, false);
    });

    it('should return true when iteration equals limit', () => {
      const state = createTestWiggumState({ iteration: 10 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, true);
    });

    it('should return true when iteration exceeds limit', () => {
      const state = createTestWiggumState({ iteration: 15 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, true);
    });

    it('should return false when iteration is 0', () => {
      const state = createTestWiggumState({ iteration: 0 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, false);
    });

    it('should return false when iteration is 9 (one below default)', () => {
      const state = createTestWiggumState({ iteration: 9 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, false);
    });
  });

  describe('with custom limit', () => {
    it('should use custom maxIterations when set', () => {
      const state = createTestWiggumState({ iteration: 5, maxIterations: 5 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, true);
    });

    it('should return false when below custom limit', () => {
      const state = createTestWiggumState({ iteration: 14, maxIterations: 15 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, false);
    });

    it('should return true when at custom limit', () => {
      const state = createTestWiggumState({ iteration: 15, maxIterations: 15 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, true);
    });

    it('should handle custom limit of 1', () => {
      const stateAtLimit = createTestWiggumState({ iteration: 1, maxIterations: 1 });
      const stateBelowLimit = createTestWiggumState({ iteration: 0, maxIterations: 1 });

      assert.strictEqual(isIterationLimitReached(stateAtLimit), true);
      assert.strictEqual(isIterationLimitReached(stateBelowLimit), false);
    });

    it('should handle custom limit larger than default', () => {
      // With default (10), iteration 10 would be at limit
      // With custom (20), iteration 10 should be below limit
      const state = createTestWiggumState({ iteration: 10, maxIterations: 20 });

      const result = isIterationLimitReached(state);

      assert.strictEqual(result, false);
    });
  });
});
