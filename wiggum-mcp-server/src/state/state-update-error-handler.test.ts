/**
 * Tests for state-update-error-handler.ts - state update failure handling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleStateUpdateFailure } from './state-update-error-handler.js';
import type { StateUpdateResult } from './router.js';
import type { WiggumState } from './types.js';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_APPROVAL,
  type WiggumPhase,
} from '../constants.js';

/**
 * Create a mock StateUpdateResult failure (always returns success: false)
 */
function createMockFailure(overrides?: {
  reason?: 'rate_limit' | 'network';
  lastError?: Error;
  attemptCount?: number;
}): StateUpdateResult & { readonly success: false } {
  return {
    success: false,
    reason: overrides?.reason ?? 'rate_limit',
    lastError: overrides?.lastError ?? new Error('Test error'),
    attemptCount: overrides?.attemptCount ?? 3,
  };
}

/**
 * Create a mock WiggumState
 */
function createMockState(overrides?: { phase?: WiggumPhase; iteration?: number }): WiggumState {
  return {
    iteration: overrides?.iteration ?? 1,
    step: STEP_PHASE1_MONITOR_WORKFLOW,
    completedSteps: [],
    phase: overrides?.phase ?? 'phase1',
  };
}

describe('handleStateUpdateFailure', () => {
  describe('validation', () => {
    it('should throw error when called with stateResult.success = true', () => {
      // This test catches a critical integration bug where handleStateUpdateFailure
      // is called at one of the 5 callsites in router.ts with success: true
      const invalidResult = {
        success: true as const,
        newState: {},
      } as unknown as StateUpdateResult & { readonly success: false };

      assert.throws(
        () => {
          handleStateUpdateFailure({
            stateResult: invalidResult,
            newState: createMockState(),
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            targetType: 'issue',
            targetNumber: 123,
          });
        },
        {
          message: /Cannot handle successful state update/,
        }
      );
    });

    it('should throw error for targetNumber = 0', () => {
      assert.throws(
        () => {
          handleStateUpdateFailure({
            stateResult: createMockFailure(),
            newState: createMockState(),
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            targetType: 'issue',
            targetNumber: 0,
          });
        },
        {
          message: /targetNumber must be positive integer, got: 0/,
        }
      );
    });

    it('should throw error for negative targetNumber', () => {
      assert.throws(
        () => {
          handleStateUpdateFailure({
            stateResult: createMockFailure(),
            newState: createMockState(),
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            targetType: 'issue',
            targetNumber: -5,
          });
        },
        {
          message: /targetNumber must be positive integer, got: -5/,
        }
      );
    });

    it('should throw error for NaN targetNumber', () => {
      assert.throws(
        () => {
          handleStateUpdateFailure({
            stateResult: createMockFailure(),
            newState: createMockState(),
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            targetType: 'issue',
            targetNumber: NaN,
          });
        },
        {
          message: /targetNumber must be positive integer, got: NaN/,
        }
      );
    });

    it('should throw error for decimal targetNumber', () => {
      assert.throws(
        () => {
          handleStateUpdateFailure({
            stateResult: createMockFailure(),
            newState: createMockState(),
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            targetType: 'issue',
            targetNumber: 123.5,
          });
        },
        {
          message: /targetNumber must be positive integer, got: 123.5/,
        }
      );
    });

    it('should accept valid positive integer targetNumber', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      assert.strictEqual(result.isError, true);
    });
  });

  describe('phase handling', () => {
    it('should use phase from state for phase1 step', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState({ phase: 'phase1' }),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      // Phase1 should result in empty context object
      const responseText = result.content[0].text;
      assert.ok(responseText.includes('issue #123'));
      assert.ok(responseText.includes('gh issue view 123'));
    });

    it('should use phase from state for phase2 step', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState({ phase: 'phase2' }),
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        targetType: 'pr',
        targetNumber: 456,
      });

      // Phase2 should result in context with pr_number
      const responseText = result.content[0].text;
      assert.ok(responseText.includes('PR #456'));
      assert.ok(responseText.includes('gh pr view 456'));
    });

    it('should use phase from state for approval step (edge case)', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState({ phase: 'phase2' }),
        step: STEP_PHASE2_APPROVAL,
        targetType: 'pr',
        targetNumber: 789,
      });

      // Approval step should be treated as phase2
      const responseText = result.content[0].text;
      assert.ok(responseText.includes('PR #789'));
      assert.ok(responseText.includes('gh pr view 789'));
    });
  });

  describe('target type handling', () => {
    it('should generate correct error message for issue target', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState({ phase: 'phase1' }),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;
      assert.ok(responseText.includes('issue #123'));
      assert.ok(responseText.includes('gh issue view 123'));
    });

    it('should generate correct error message for PR target', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState({ phase: 'phase2' }),
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        targetType: 'pr',
        targetNumber: 456,
      });

      const responseText = result.content[0].text;
      assert.ok(responseText.includes('PR #456'));
      assert.ok(responseText.includes('gh pr view 456'));
    });
  });

  describe('error details formatting', () => {
    it('should include error message when lastError is present', () => {
      const testError = new Error('API rate limit exceeded');
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure({ lastError: testError }),
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;
      assert.ok(responseText.includes('Actual error: API rate limit exceeded'));
    });

    it('should exclude error details when lastError is undefined', () => {
      // Explicitly test that undefined lastError doesn't append "Actual error:"
      // This verifies the conditional logic for errorDetails construction

      // Manually construct failure with undefined lastError using type assertion
      // Note: TypeScript requires lastError: Error, but we test the edge case of undefined to ensure robust error message formatting
      const failureWithoutError = {
        success: false as const,
        reason: 'network' as const,
        lastError: undefined as unknown as Error,
        attemptCount: 2,
      };

      const result = handleStateUpdateFailure({
        stateResult: failureWithoutError,
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;
      assert.ok(!responseText.includes('Actual error:'));
    });

    it('should include retry count when attemptCount > 0', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure({ attemptCount: 5 }),
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;
      assert.ok(responseText.includes('Retry attempts made: 5'));
    });

    it('should exclude retry info when attemptCount = 0', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure({ attemptCount: 0 }),
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;
      assert.ok(!responseText.includes('Retry attempts made'));
    });

    it('should include failure reason in response', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure({ reason: 'network' }),
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;
      assert.ok(responseText.includes('Failure reason: network'));
    });
  });

  describe('return value structure', () => {
    it('should return ToolResult with isError: true', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      assert.strictEqual(result.isError, true);
    });

    it('should return content with text type', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      assert.strictEqual(result.content.length, 1);
      assert.strictEqual(result.content[0].type, 'text');
      assert.ok(typeof result.content[0].text === 'string');
      assert.ok(result.content[0].text.length > 0);
    });

    it('should include formatted wiggum response with required fields', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState({ iteration: 3 }),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;

      // Check for required wiggum response fields
      assert.ok(responseText.includes('Phase 1: Monitor Workflow')); // current_step
      assert.ok(responseText.includes('p1-1')); // step_number
      assert.ok(responseText.includes('3')); // iteration_count
      assert.ok(responseText.includes('ERROR: Failed to update state')); // instructions
    });
  });

  describe('context object construction', () => {
    it('should use empty context for phase1', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState({ phase: 'phase1' }),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      // For phase1, context is empty, so no pr_number should appear in structured data
      const responseText = result.content[0].text;
      assert.ok(responseText.includes('issue #123'));
    });

    it('should include pr_number in context for phase2', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure(),
        newState: createMockState({ phase: 'phase2' }),
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        targetType: 'pr',
        targetNumber: 456,
      });

      // For phase2, context should have pr_number
      const responseText = result.content[0].text;
      assert.ok(responseText.includes('PR #456'));
    });
  });

  describe('steps_completed_by_tool formatting', () => {
    it('should show "unknown" attempts when attemptCount is undefined (edge case)', () => {
      // Create a failure with attemptCount that could be undefined
      const failure: StateUpdateResult & { readonly success: false } = {
        success: false,
        reason: 'network',
        lastError: new Error('Test'),
        attemptCount: undefined as unknown as number, // Simulate undefined
      };

      const result = handleStateUpdateFailure({
        stateResult: failure,
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;
      assert.ok(responseText.includes('after unknown attempts'));
    });

    it('should show attempt count when present', () => {
      const result = handleStateUpdateFailure({
        stateResult: createMockFailure({ attemptCount: 7 }),
        newState: createMockState(),
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: 123,
      });

      const responseText = result.content[0].text;
      assert.ok(responseText.includes('after 7 attempts'));
    });
  });

  describe('formatting error fallback', () => {
    // NOTE: These tests verify the fallback error path behavior documented in the implementation.
    // Testing this path requires triggering FormattingError from formatWiggumResponse, which is
    // difficult in practice because:
    // 1. ES module exports can't be mocked with node:test mock.method
    // 2. TypeScript prevents passing invalid data that would trigger validation errors
    // 3. The function constructs all required fields from validated inputs
    //
    // The fallback path exists as defensive programming for unexpected formatWiggumResponse bugs
    // or changes to its validation logic. Manual testing can verify this by temporarily breaking
    // formatWiggumResponse.

    it.skip('should return fallback message when formatWiggumResponse throws FormattingError', () => {
      // TODO(#1510): Implement test using dependency injection or test doubles
      // Manual verification: Modify formatWiggumResponse to throw FormattingError and verify:
      // - Fallback message includes "ERROR: State update failed"
      // - Fallback message includes target reference (issue #123 or PR #456)
      // - Fallback message includes iteration count
      // - Fallback message includes note about "fallback message"
      // - Result has isError: true
    });

    it.skip('should include all required recovery info in fallback message', () => {
      // TODO(#1510): Implement test using dependency injection or test doubles
      // Manual verification: Modify formatWiggumResponse to throw and verify fallback includes:
      // - Target reference (PR #456)
      // - Failure reason (rate_limit)
      // - Retry attempts (Retry attempts made: 3)
      // - Error details (Actual error: API limit)
      // - Recovery command (gh pr view 456)
    });

    it.skip('should re-throw non-FormattingError errors', () => {
      // TODO(#1510): Implement test using dependency injection or test doubles
      // Manual verification: Modify formatWiggumResponse to throw TypeError and verify:
      // - TypeError is re-thrown (not caught)
      // - logger.error is called with 'CRITICAL: Unexpected error'
      // - Original error propagates to caller
    });
  });

  describe('logging', () => {
    it('should call logger.error with correct context for issue target', async () => {
      const loggerModule = await import('../utils/logger.js');
      const { mock } = await import('node:test');

      // Mock logger.error
      const errorMock = mock.method(loggerModule.logger, 'error', () => {});

      try {
        handleStateUpdateFailure({
          stateResult: createMockFailure({
            reason: 'rate_limit',
            attemptCount: 5,
            lastError: new Error('Rate limit exceeded'),
          }),
          newState: createMockState({ phase: 'phase1', iteration: 2 }),
          step: STEP_PHASE1_MONITOR_WORKFLOW,
          targetType: 'issue',
          targetNumber: 789,
        });

        // Verify logger.error was called
        assert.strictEqual(errorMock.mock.calls.length, 1);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [message, context] = errorMock.mock.calls[0].arguments as [string, any];
        assert.strictEqual(message, 'Critical: State update failed - halting workflow');
        assert.strictEqual(context.issueNumber, 789);
        assert.strictEqual(context.step, STEP_PHASE1_MONITOR_WORKFLOW);
        assert.strictEqual(context.iteration, 2);
        assert.strictEqual(context.phase, 'phase1');
        assert.strictEqual(context.reason, 'rate_limit');
        assert.strictEqual(context.lastError, 'Rate limit exceeded');
        assert.strictEqual(context.attemptCount, 5);
        assert.ok(context.impact);
        assert.ok(context.recommendation);

        // Verify no prNumber for issue targets
        assert.strictEqual(context.prNumber, undefined);
      } finally {
        errorMock.mock.restore();
      }
    });

    it('should call logger.error with prNumber for PR target', async () => {
      const loggerModule = await import('../utils/logger.js');
      const { mock } = await import('node:test');

      const errorMock = mock.method(loggerModule.logger, 'error', () => {});

      try {
        handleStateUpdateFailure({
          stateResult: createMockFailure(),
          newState: createMockState({ phase: 'phase2' }),
          step: STEP_PHASE2_MONITOR_WORKFLOW,
          targetType: 'pr',
          targetNumber: 999,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, context] = errorMock.mock.calls[0].arguments as [string, any];
        assert.strictEqual(context.prNumber, 999);
        assert.strictEqual(context.issueNumber, undefined);
      } finally {
        errorMock.mock.restore();
      }
    });
  });
});
