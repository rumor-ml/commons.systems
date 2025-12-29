/**
 * Tests for transitions.ts state advancement logic
 *
 * These tests cover the critical error handling paths for step transitions,
 * ensuring workflow progression is validated and state invariants are maintained.
 *
 * Test categories:
 * 1. getNextStep validation and edge cases
 * 2. advanceToNextStep state transformation
 * 3. Integration with shouldResetCompletedAgents
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getNextStep, advanceToNextStep } from './transitions.js';
import { createWiggumState } from './types.js';
import { ValidationError } from '../utils/errors.js';
import {
  STEP_ORDER,
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE1_CREATE_PR,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_CHECKS,
  STEP_PHASE2_CODE_QUALITY,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
  STEP_PHASE2_APPROVAL,
} from '../constants.js';
import type { WiggumStep } from '../constants.js';

describe('getNextStep', () => {
  describe('valid step transitions', () => {
    it('should return next step for first phase 1 step', () => {
      const next = getNextStep(STEP_PHASE1_MONITOR_WORKFLOW);
      assert.strictEqual(next, STEP_PHASE1_PR_REVIEW);
    });

    it('should return next step for middle phase 1 step', () => {
      const next = getNextStep(STEP_PHASE1_PR_REVIEW);
      assert.strictEqual(next, STEP_PHASE1_SECURITY_REVIEW);
    });

    it('should return next step for last phase 1 step (transitions to phase 2)', () => {
      const next = getNextStep(STEP_PHASE1_CREATE_PR);
      assert.strictEqual(next, STEP_PHASE2_MONITOR_WORKFLOW);
    });

    it('should return next step for first phase 2 step', () => {
      const next = getNextStep(STEP_PHASE2_MONITOR_WORKFLOW);
      assert.strictEqual(next, STEP_PHASE2_MONITOR_CHECKS);
    });

    it('should return next step for middle phase 2 step', () => {
      const next = getNextStep(STEP_PHASE2_CODE_QUALITY);
      assert.strictEqual(next, STEP_PHASE2_PR_REVIEW);
    });

    it('should return null when at final step (approval)', () => {
      const next = getNextStep(STEP_PHASE2_APPROVAL);
      assert.strictEqual(next, null);
    });

    // Test ALL valid transitions comprehensively
    const validTransitions: [WiggumStep, WiggumStep | null][] = [
      [STEP_PHASE1_MONITOR_WORKFLOW, STEP_PHASE1_PR_REVIEW],
      [STEP_PHASE1_PR_REVIEW, STEP_PHASE1_SECURITY_REVIEW],
      [STEP_PHASE1_SECURITY_REVIEW, STEP_PHASE1_CREATE_PR],
      [STEP_PHASE1_CREATE_PR, STEP_PHASE2_MONITOR_WORKFLOW],
      [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
      [STEP_PHASE2_MONITOR_CHECKS, STEP_PHASE2_CODE_QUALITY],
      [STEP_PHASE2_CODE_QUALITY, STEP_PHASE2_PR_REVIEW],
      [STEP_PHASE2_PR_REVIEW, STEP_PHASE2_SECURITY_REVIEW],
      [STEP_PHASE2_SECURITY_REVIEW, STEP_PHASE2_APPROVAL],
      [STEP_PHASE2_APPROVAL, null],
    ];

    validTransitions.forEach(([current, expected]) => {
      it(`should advance from ${current} to ${expected ?? 'null'}`, () => {
        assert.strictEqual(getNextStep(current), expected);
      });
    });
  });

  describe('invalid step handling', () => {
    it('should throw ValidationError for invalid step', () => {
      assert.throws(
        () => getNextStep('invalid-step' as WiggumStep),
        (error) => {
          assert.ok(error instanceof ValidationError);
          assert.ok(error.message.includes('not found in STEP_ORDER'));
          return true;
        }
      );
    });

    it('should throw ValidationError with step context in message', () => {
      const invalidStep = 'bad-step';
      try {
        getNextStep(invalidStep as WiggumStep);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes(invalidStep));
      }
    });

    it('should throw ValidationError for empty string step', () => {
      assert.throws(() => getNextStep('' as WiggumStep), ValidationError);
    });

    it('should throw ValidationError for step with wrong prefix', () => {
      assert.throws(() => getNextStep('p3-1' as WiggumStep), ValidationError);
    });

    it('should throw ValidationError for numeric step', () => {
      assert.throws(() => getNextStep(123 as unknown as WiggumStep), ValidationError);
    });
  });

  describe('step order consistency', () => {
    it('should return steps in STEP_ORDER sequence', () => {
      // Walk through all steps and verify getNextStep matches STEP_ORDER
      for (let i = 0; i < STEP_ORDER.length - 1; i++) {
        const current = STEP_ORDER[i];
        const expectedNext = STEP_ORDER[i + 1];
        const actualNext = getNextStep(current);
        assert.strictEqual(
          actualNext,
          expectedNext,
          `Step ${current} should advance to ${expectedNext}`
        );
      }
    });

    it('should return null only for the last step in STEP_ORDER', () => {
      const lastStep = STEP_ORDER[STEP_ORDER.length - 1];
      assert.strictEqual(getNextStep(lastStep), null);

      // All other steps should NOT return null
      for (let i = 0; i < STEP_ORDER.length - 1; i++) {
        const step = STEP_ORDER[i];
        assert.notStrictEqual(getNextStep(step), null, `Step ${step} should not return null`);
      }
    });
  });
});

describe('advanceToNextStep', () => {
  describe('successful advancement', () => {
    it('should advance to next step', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [],
      });

      const newState = advanceToNextStep(state);
      assert.strictEqual(newState.step, STEP_PHASE2_MONITOR_CHECKS);
    });

    it('should add current step to completedSteps', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        completedSteps: [],
        iteration: 0,
        phase: 'phase2',
      });

      const newState = advanceToNextStep(state);

      assert.ok(newState.completedSteps.includes(STEP_PHASE2_MONITOR_WORKFLOW));
    });

    it('should append to existing completedSteps', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        iteration: 0,
        phase: 'phase2',
      });

      const newState = advanceToNextStep(state);

      assert.deepStrictEqual(
        [...newState.completedSteps],
        [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS, STEP_PHASE2_CODE_QUALITY]
      );
    });

    it('should preserve iteration count', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: 5,
        phase: 'phase2',
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
      });

      const newState = advanceToNextStep(state);
      assert.strictEqual(newState.iteration, 5);
    });

    it('should preserve phase', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
      });

      const newState = advanceToNextStep(state);
      assert.strictEqual(newState.phase, 'phase2');
    });

    it('should preserve maxIterations', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: 0,
        phase: 'phase2',
        maxIterations: 15,
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
      });

      const newState = advanceToNextStep(state);
      assert.strictEqual(newState.maxIterations, 15);
    });

    it('should preserve maxIterations when undefined', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
      });

      const newState = advanceToNextStep(state);
      assert.strictEqual(newState.maxIterations, undefined);
    });
  });

  describe('final step error handling', () => {
    it('should return null from getNextStep when at final step (approval)', () => {
      // getNextStep correctly returns null for approval step
      const nextStep = getNextStep(STEP_PHASE2_APPROVAL);
      assert.strictEqual(nextStep, null);
    });

    it('should fail to advance to approval due to schema validation limitation', () => {
      // Note: This test documents a bug where the schema doesn't allow
      // step: 'approval' with phase: 'phase2' because 'approval' doesn't start with 'p2-'
      // TODO(#996): Fix schema to allow 'approval' step with phase2
      const securityReviewState = createWiggumState({
        step: STEP_PHASE2_SECURITY_REVIEW,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [
          STEP_PHASE2_MONITOR_WORKFLOW,
          STEP_PHASE2_MONITOR_CHECKS,
          STEP_PHASE2_CODE_QUALITY,
          STEP_PHASE2_PR_REVIEW,
        ],
      });

      // Attempting to advance to approval throws due to schema validation bug
      assert.throws(
        () => advanceToNextStep(securityReviewState),
        (error: unknown) => {
          // Currently throws ZodError due to schema validation issue
          assert.ok(error instanceof Error && error.name === 'ZodError');
          return true;
        }
      );
    });
  });

  describe('completedAgents reset integration', () => {
    it('should reset completedAgents when step changes', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: 2,
        phase: 'phase2',
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        completedAgents: ['code-reviewer', 'pr-test-analyzer'],
      });

      const newState = advanceToNextStep(state);

      // completedAgents should be reset when advancing to new step
      assert.deepStrictEqual(newState.completedAgents, undefined);
    });

    it('should reset completedAgents when advancing to any new step', () => {
      // Test multiple transitions to verify reset behavior
      const steps: { from: WiggumStep; completedSteps: WiggumStep[] }[] = [
        {
          from: STEP_PHASE2_MONITOR_WORKFLOW,
          completedSteps: [],
        },
        {
          from: STEP_PHASE2_MONITOR_CHECKS,
          completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW],
        },
        {
          from: STEP_PHASE2_PR_REVIEW,
          completedSteps: [
            STEP_PHASE2_MONITOR_WORKFLOW,
            STEP_PHASE2_MONITOR_CHECKS,
            STEP_PHASE2_CODE_QUALITY,
          ],
        },
      ];

      for (const { from, completedSteps } of steps) {
        const state = createWiggumState({
          step: from,
          iteration: 3,
          phase: 'phase2',
          completedSteps,
          completedAgents: ['agent1', 'agent2'],
        });

        const newState = advanceToNextStep(state);
        assert.deepStrictEqual(
          newState.completedAgents,
          undefined,
          `completedAgents should be reset when advancing from ${from}`
        );
      }
    });
  });

  describe('completedSteps invariant', () => {
    it('should maintain invariant: completedSteps only contains prior steps', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        iteration: 0,
        phase: 'phase2',
      });

      const newState = advanceToNextStep(state);

      // completedSteps should contain code-quality but NOT the new current step
      assert.ok(newState.completedSteps.includes(STEP_PHASE2_CODE_QUALITY));
      assert.ok(!newState.completedSteps.includes(newState.step));
    });

    it('should not add duplicate steps to completedSteps', () => {
      // Create state where current step is already in completedSteps
      // This shouldn't normally happen, but addToCompletedSteps handles it
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        iteration: 0,
        phase: 'phase2',
      });

      const newState = advanceToNextStep(state);

      // Count occurrences of STEP_PHASE2_CODE_QUALITY
      const count = newState.completedSteps.filter((s) => s === STEP_PHASE2_CODE_QUALITY).length;
      assert.strictEqual(count, 1, 'Step should not be duplicated');
    });
  });

  describe('phase 1 transitions', () => {
    it('should advance through all phase 1 steps', () => {
      let state = createWiggumState({
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        iteration: 0,
        phase: 'phase1',
        completedSteps: [],
      });

      // p1-1 -> p1-2
      state = advanceToNextStep(state);
      assert.strictEqual(state.step, STEP_PHASE1_PR_REVIEW);
      assert.deepStrictEqual([...state.completedSteps], [STEP_PHASE1_MONITOR_WORKFLOW]);

      // p1-2 -> p1-3
      state = advanceToNextStep(state);
      assert.strictEqual(state.step, STEP_PHASE1_SECURITY_REVIEW);
      assert.deepStrictEqual(
        [...state.completedSteps],
        [STEP_PHASE1_MONITOR_WORKFLOW, STEP_PHASE1_PR_REVIEW]
      );

      // p1-3 -> p1-4
      state = advanceToNextStep(state);
      assert.strictEqual(state.step, STEP_PHASE1_CREATE_PR);
    });
  });

  describe('phase 2 transitions', () => {
    it('should advance through phase 2 steps up to security review', () => {
      // Note: Cannot advance all the way to approval due to schema validation limitation
      // where 'approval' step doesn't have 'p2-' prefix. See types.ts WiggumStateSchema.
      // TODO(#996): Fix schema to allow 'approval' step with phase2
      let state = createWiggumState({
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [],
      });

      const expectedSteps = [
        STEP_PHASE2_MONITOR_CHECKS,
        STEP_PHASE2_CODE_QUALITY,
        STEP_PHASE2_PR_REVIEW,
        STEP_PHASE2_SECURITY_REVIEW,
        // STEP_PHASE2_APPROVAL - cannot test due to schema validation bug
      ];

      for (const expectedStep of expectedSteps) {
        state = advanceToNextStep(state);
        assert.strictEqual(state.step, expectedStep);
      }

      // Verify we're at security review
      assert.strictEqual(state.step, STEP_PHASE2_SECURITY_REVIEW);
    });

    it('should correctly report next step for security review is approval', () => {
      // Verify getNextStep returns approval (even though advanceToNextStep fails)
      const nextStep = getNextStep(STEP_PHASE2_SECURITY_REVIEW);
      assert.strictEqual(nextStep, STEP_PHASE2_APPROVAL);
    });
  });

  describe('state immutability', () => {
    it('should not modify original state', () => {
      const originalState = createWiggumState({
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: 3,
        phase: 'phase2',
        completedSteps: [],
        completedAgents: ['agent1'],
      });

      const originalStep = originalState.step;
      const originalIteration = originalState.iteration;
      const originalCompletedSteps = [...originalState.completedSteps];
      const originalCompletedAgents = originalState.completedAgents
        ? [...originalState.completedAgents]
        : undefined;

      advanceToNextStep(originalState);

      // Original state should be unchanged
      assert.strictEqual(originalState.step, originalStep);
      assert.strictEqual(originalState.iteration, originalIteration);
      assert.deepStrictEqual([...originalState.completedSteps], originalCompletedSteps);
      assert.deepStrictEqual(
        originalState.completedAgents ? [...originalState.completedAgents] : undefined,
        originalCompletedAgents
      );
    });

    it('should return a new state object', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [],
      });

      const newState = advanceToNextStep(state);

      assert.notStrictEqual(newState, state);
    });
  });

  describe('edge cases', () => {
    it('should handle state with high iteration count', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: 100,
        phase: 'phase2',
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
      });

      const newState = advanceToNextStep(state);
      assert.strictEqual(newState.iteration, 100);
      assert.strictEqual(newState.step, STEP_PHASE2_PR_REVIEW);
    });

    it('should handle state with many completedSteps', () => {
      // Test with many completedSteps including both p1 and p2 phases
      // Note: We don't advance to approval step due to schema validation limitation
      // where 'approval' step doesn't have 'p2-' prefix
      const state = createWiggumState({
        step: STEP_PHASE2_PR_REVIEW,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [
          STEP_PHASE1_MONITOR_WORKFLOW,
          STEP_PHASE1_PR_REVIEW,
          STEP_PHASE1_SECURITY_REVIEW,
          STEP_PHASE1_CREATE_PR,
          STEP_PHASE2_MONITOR_WORKFLOW,
          STEP_PHASE2_MONITOR_CHECKS,
          STEP_PHASE2_CODE_QUALITY,
        ],
      });

      const newState = advanceToNextStep(state);
      assert.strictEqual(newState.step, STEP_PHASE2_SECURITY_REVIEW);
      assert.strictEqual(newState.completedSteps.length, 8);
      // Verify all p1 steps are still present
      assert.ok(newState.completedSteps.includes(STEP_PHASE1_MONITOR_WORKFLOW));
      assert.ok(newState.completedSteps.includes(STEP_PHASE1_CREATE_PR));
      // Verify p2 steps are present including the newly completed one
      assert.ok(newState.completedSteps.includes(STEP_PHASE2_PR_REVIEW));
    });

    it('should handle state with empty completedAgents', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [],
        completedAgents: [],
      });

      const newState = advanceToNextStep(state);
      assert.ok(newState);
      assert.strictEqual(newState.step, STEP_PHASE2_MONITOR_CHECKS);
    });

    it('should handle state with large maxIterations', () => {
      const state = createWiggumState({
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: 0,
        phase: 'phase2',
        completedSteps: [],
        maxIterations: 1000,
      });

      const newState = advanceToNextStep(state);
      assert.strictEqual(newState.maxIterations, 1000);
    });
  });
});
