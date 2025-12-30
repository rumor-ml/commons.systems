/**
 * State transition utilities for wiggum workflow
 *
 * Provides helpers for advancing through workflow steps while maintaining
 * valid state invariants (completedSteps must only contain steps before current step).
 */

import { WiggumStep, STEP_ORDER } from '../constants.js';
import { WiggumState, createWiggumState } from './types.js';
import { addToCompletedSteps } from './state-utils.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Get the next step in the workflow after the given step
 *
 * @param currentStep - The current step
 * @returns The next step in STEP_ORDER, or null if at the last step
 * @throws {ValidationError} If currentStep is not a valid step
 */
export function getNextStep(currentStep: WiggumStep): WiggumStep | null {
  const currentIndex = STEP_ORDER.indexOf(currentStep);

  if (currentIndex === -1) {
    throw new ValidationError(`Invalid step: ${currentStep} not found in STEP_ORDER`);
  }

  if (currentIndex === STEP_ORDER.length - 1) {
    // At the last step (approval)
    return null;
  }

  return STEP_ORDER[currentIndex + 1];
}

/**
 * Advance to the next step in the workflow
 *
 * Marks the current step as complete and advances to the next step.
 * Maintains the invariant that completedSteps only contains steps before the current step.
 *
 * @param state - The current wiggum state
 * @returns New state with current step marked complete and advanced to next step
 * @throws {ValidationError} If already at the last step or if step is invalid
 */
export function advanceToNextStep(state: WiggumState): WiggumState {
  const nextStep = getNextStep(state.step);

  if (nextStep === null) {
    throw new ValidationError(
      `Cannot advance from step ${state.step}: already at final step (approval)`
    );
  }

  return createWiggumState({
    iteration: state.iteration,
    step: nextStep,
    completedSteps: addToCompletedSteps(state.completedSteps, state.step),
    phase: state.phase,
    maxIterations: state.maxIterations,
  });
}
