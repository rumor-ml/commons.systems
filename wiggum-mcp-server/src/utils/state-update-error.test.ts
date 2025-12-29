/**
 * Tests for state update error response builder
 *
 * This module tests the buildStateUpdateFailureResponse function that creates
 * standardized error responses when GitHub API state updates fail.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { buildStateUpdateFailureResponse } from './state-update-error.js';
import type { StateUpdateFailureParams } from './state-update-error.js';
import type { CurrentState, WiggumState } from '../state/types.js';
import { createWiggumState, createPRExists, createPRDoesNotExist } from '../state/types.js';
import {
  STEP_PHASE1_CREATE_PR,
  STEP_PHASE2_CODE_QUALITY,
  STEP_PHASE2_PR_REVIEW,
  STEP_NAMES,
} from '../constants.js';
import { logger } from './logger.js';

/**
 * Create a mock CurrentState for phase 2 (post-PR)
 *
 * Note: completedSteps must only contain steps BEFORE the current step in STEP_ORDER
 * STEP_ORDER: p2-1, p2-2, p2-3 (code quality), p2-4 (PR review), p2-5 (security), approval
 */
function createMockPhase2State(overrides?: Partial<CurrentState>): CurrentState {
  return {
    git: {
      currentBranch: '625-test-branch',
      isMainBranch: false,
      hasUncommittedChanges: false,
      isRemoteTracking: true,
      isPushed: true,
    },
    pr: createPRExists({
      number: 123,
      title: 'Test PR',
      state: 'OPEN',
      url: 'https://github.com/test/repo/pull/123',
      labels: [],
      headRefName: '625-test-branch',
      baseRefName: 'main',
    }),
    issue: { exists: false },
    wiggum: createWiggumState({
      iteration: 1,
      step: STEP_PHASE2_CODE_QUALITY, // p2-3
      completedSteps: [
        'p2-1' as const, // Monitor Workflow - before p2-3
        'p2-2' as const, // Monitor Checks - before p2-3
      ],
      phase: 'phase2',
    }),
    ...overrides,
  };
}

/**
 * Create a mock CurrentState for phase 1 (pre-PR)
 *
 * Note: completedSteps must only contain steps BEFORE the current step in STEP_ORDER
 * STEP_ORDER: p1-1, p1-2, p1-3, p1-4 (create PR)
 */
function createMockPhase1State(overrides?: Partial<CurrentState>): CurrentState {
  return {
    git: {
      currentBranch: '625-test-branch',
      isMainBranch: false,
      hasUncommittedChanges: false,
      isRemoteTracking: true,
      isPushed: true,
    },
    pr: createPRDoesNotExist(),
    issue: { exists: true, number: 625 },
    wiggum: createWiggumState({
      iteration: 1,
      step: STEP_PHASE1_CREATE_PR, // p1-4
      completedSteps: [
        'p1-1' as const, // Monitor Workflow - before p1-4
        'p1-2' as const, // Code Review - before p1-4
        'p1-3' as const, // Security Review - before p1-4
      ],
      phase: 'phase1',
    }),
    ...overrides,
  };
}

/**
 * Create a mock WiggumState for newState parameter
 *
 * Note: completedSteps must only contain steps BEFORE the current step in STEP_ORDER
 * STEP_ORDER: p2-1, p2-2, p2-3, p2-4 (PR review), p2-5 (security), approval
 */
function createMockNewState(overrides?: Partial<WiggumState>): WiggumState {
  return createWiggumState({
    iteration: 2,
    step: STEP_PHASE2_PR_REVIEW, // p2-4
    completedSteps: [
      'p2-1' as const, // Monitor Workflow - before p2-4
      'p2-2' as const, // Monitor Checks - before p2-4
      'p2-3' as const, // Code Quality - before p2-4
    ],
    phase: 'phase2',
    ...overrides,
  });
}

describe('buildStateUpdateFailureResponse', () => {
  let loggerErrorMock: ReturnType<typeof mock.method>;

  beforeEach(() => {
    // Mock logger.error to verify logging behavior
    loggerErrorMock = mock.method(logger, 'error', () => {});
  });

  afterEach(() => {
    loggerErrorMock.mock.restore();
  });

  describe('Error Response Content', () => {
    it('should include failure reason in error message', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'GitHub API rate limit exceeded' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);

      assert.strictEqual(result.content.length, 1);
      assert.strictEqual(result.content[0].type, 'text');
      const text = result.content[0].text;
      assert.ok(
        text.includes('GitHub API rate limit exceeded'),
        'Should include failure reason in message'
      );
    });

    it('should warn that state was NOT modified', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'network error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_fix',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      assert.ok(
        text.includes('Your workflow state has NOT been modified'),
        'Should warn that state was not modified'
      );
      assert.ok(text.includes('You are still on:'), 'Should indicate current step');
    });

    it('should include current step name', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      // Check that step name appears in the response
      const expectedStepName = STEP_NAMES[STEP_PHASE2_CODE_QUALITY];
      assert.ok(text.includes(expectedStepName), `Should include step name: ${expectedStepName}`);
    });

    it('should include recovery instructions', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'rate limit' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      assert.ok(text.includes('To resolve:'), 'Should include resolution instructions');
      assert.ok(text.includes('gh api rate_limit'), 'Should include rate limit check command');
      assert.ok(
        text.includes('Verify network connectivity'),
        'Should include network check instruction'
      );
      assert.ok(text.includes('Retry by calling'), 'Should include retry instruction');
    });

    it('should include tool name in retry instructions', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_fix',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      assert.ok(
        text.includes('wiggum_complete_fix'),
        'Should include tool name in retry instructions'
      );
    });

    it('should set isError flag to true', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);

      assert.strictEqual(result.isError, true, 'Should set isError flag to true');
    });
  });

  describe('Phase-Specific Context', () => {
    it('should include PR number in context for phase2', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      // The response should include PR number in context section
      assert.ok(text.includes('123'), 'Should include PR number in response');
    });

    it('should include issue number in context for phase1', () => {
      const state = createMockPhase1State();
      const newState = createWiggumState({
        iteration: 2,
        step: STEP_PHASE1_CREATE_PR,
        completedSteps: ['p1-1' as const, 'p1-2' as const, 'p1-3' as const],
        phase: 'phase1',
      });

      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState,
        phase: 'phase1',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      // The response should include issue number in context section
      assert.ok(text.includes('625'), 'Should include issue number in response');
    });

    it('should throw ValidationError for phase2 with PR not existing', () => {
      // This is an edge case that shouldn't normally happen - getTargetNumber throws
      const state: CurrentState = {
        git: {
          currentBranch: '625-test-branch',
          isMainBranch: false,
          hasUncommittedChanges: false,
          isRemoteTracking: true,
          isPushed: true,
        },
        pr: createPRDoesNotExist(),
        issue: { exists: false },
        wiggum: createWiggumState({
          iteration: 1,
          step: STEP_PHASE2_CODE_QUALITY, // p2-3
          completedSteps: ['p2-1' as const, 'p2-2' as const], // Only steps before p2-3
          phase: 'phase2',
        }),
      };

      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      // getTargetNumber throws ValidationError when phase2 has no PR
      assert.throws(
        () => buildStateUpdateFailureResponse(params),
        (error: Error) => {
          assert.ok(error.message.includes('No PR found'), 'Should throw about missing PR');
          return true;
        }
      );
    });

    it('should throw ValidationError for phase1 with issue not existing', () => {
      // This is an edge case that shouldn't normally happen - getTargetNumber throws
      const state: CurrentState = {
        git: {
          currentBranch: '625-test-branch',
          isMainBranch: false,
          hasUncommittedChanges: false,
          isRemoteTracking: true,
          isPushed: true,
        },
        pr: createPRDoesNotExist(),
        issue: { exists: false },
        wiggum: createWiggumState({
          iteration: 1,
          step: STEP_PHASE1_CREATE_PR,
          completedSteps: ['p1-1' as const, 'p1-2' as const, 'p1-3' as const],
          phase: 'phase1',
        }),
      };

      const newState = createWiggumState({
        iteration: 2,
        step: STEP_PHASE1_CREATE_PR,
        completedSteps: ['p1-1' as const, 'p1-2' as const, 'p1-3' as const],
        phase: 'phase1',
      });

      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState,
        phase: 'phase1',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      // getTargetNumber throws ValidationError when phase1 has no issue
      assert.throws(
        () => buildStateUpdateFailureResponse(params),
        (error: Error) => {
          assert.ok(error.message.includes('No issue found'), 'Should throw about missing issue');
          return true;
        }
      );
    });
  });

  describe('Steps Completed and Iteration', () => {
    it('should include steps_completed_by_tool in response', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: ['Step 1: Validated input', 'Step 2: Read manifests'],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      // formatWiggumResponse should include steps_completed_by_tool
      assert.ok(text.includes('Validated input'), 'Should include first step');
      assert.ok(text.includes('Read manifests'), 'Should include second step');
    });

    it('should handle empty stepsCompleted array', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);

      assert.strictEqual(result.isError, true, 'Should return error response');
      assert.strictEqual(result.content.length, 1, 'Should have content');
      // Empty array should not crash, formatWiggumResponse shows "(none)"
      const text = result.content[0].text;
      assert.ok(text.includes('(none)'), 'Should show (none) for empty steps');
    });

    it('should include iteration count from newState', () => {
      const state = createMockPhase2State();
      const newState = createWiggumState({
        iteration: 7,
        step: STEP_PHASE2_PR_REVIEW,
        completedSteps: ['p2-1' as const, 'p2-2' as const, 'p2-3' as const],
        phase: 'phase2',
      });

      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState,
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      // formatWiggumResponse should include iteration_count
      assert.ok(text.includes('7'), 'Should include iteration count from newState');
    });
  });

  describe('Logging Behavior', () => {
    it('should log error with correct context', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'rate limit exceeded' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      buildStateUpdateFailureResponse(params);

      // Verify logger.error was called
      assert.strictEqual(loggerErrorMock.mock.callCount(), 1, 'Should call logger.error once');

      const call = loggerErrorMock.mock.calls[0];
      const message = call.arguments[0] as string;
      const data = call.arguments[1] as Record<string, unknown>;

      assert.ok(
        message.includes('State update failed'),
        'Log message should mention state update failure'
      );
      assert.strictEqual(data.reason, 'rate limit exceeded', 'Should log failure reason');
      assert.strictEqual(data.phase, 'phase2', 'Should log phase');
      assert.strictEqual(data.step, STEP_PHASE2_CODE_QUALITY, 'Should log step');
    });

    it('should log PR number for phase2', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      buildStateUpdateFailureResponse(params);

      const call = loggerErrorMock.mock.calls[0];
      const data = call.arguments[1] as Record<string, unknown>;

      assert.strictEqual(data.targetNumber, 123, 'Should log PR number as targetNumber');
    });

    it('should log issue number for phase1', () => {
      const state = createMockPhase1State();
      const newState = createWiggumState({
        iteration: 2,
        step: STEP_PHASE1_CREATE_PR,
        completedSteps: ['p1-1' as const, 'p1-2' as const, 'p1-3' as const],
        phase: 'phase1',
      });

      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState,
        phase: 'phase1',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      buildStateUpdateFailureResponse(params);

      const call = loggerErrorMock.mock.calls[0];
      const data = call.arguments[1] as Record<string, unknown>;

      assert.strictEqual(data.targetNumber, 625, 'Should log issue number as targetNumber');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long failure reason', () => {
      const state = createMockPhase2State();
      const longReason = 'x'.repeat(1000);

      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: longReason },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      // Should include reason (maybe truncated)
      assert.ok(text.length > 0, 'Should produce non-empty response');
      assert.ok(text.includes('x'.repeat(100)), 'Should include at least part of long reason');
    });

    it('should work with different tool names', () => {
      const state = createMockPhase2State();
      const toolNames = [
        'wiggum_complete_all_hands',
        'wiggum_complete_fix',
        'wiggum_complete_security_review',
      ];

      for (const toolName of toolNames) {
        const params: StateUpdateFailureParams = {
          state,
          stateResult: { success: false, reason: 'error' },
          newState: createMockNewState(),
          phase: 'phase2',
          stepsCompleted: [],
          toolName,
        };

        const result = buildStateUpdateFailureResponse(params);
        const text = result.content[0].text;

        assert.ok(text.includes(toolName), `Should include tool name: ${toolName}`);
      }
    });

    it('should include step number in response', () => {
      const state = createMockPhase2State();
      const params: StateUpdateFailureParams = {
        state,
        stateResult: { success: false, reason: 'error' },
        newState: createMockNewState(),
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      };

      const result = buildStateUpdateFailureResponse(params);
      const text = result.content[0].text;

      // The step number (p2-3) should be in the response
      assert.ok(
        text.includes(STEP_PHASE2_CODE_QUALITY),
        `Should include step number: ${STEP_PHASE2_CODE_QUALITY}`
      );
    });
  });
});
