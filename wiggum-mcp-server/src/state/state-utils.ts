/**
 * State management utilities for Wiggum workflow
 *
 * This module provides helper functions for common state operations:
 * - Deduplicating completed steps
 * - Logging state reuse (for race condition fix #388)
 * - Creating updated state objects
 */

import { logger } from '../utils/logger.js';
import { DEFAULT_MAX_ITERATIONS } from '../constants.js';
import type { WiggumStep, WiggumPhase } from '../constants.js';
import type { WiggumState, CurrentState } from './types.js';

/**
 * Add a step to completedSteps with deduplication
 *
 * Ensures no duplicate entries in the completed steps array.
 * This prevents issues when the same step completion is triggered multiple times.
 *
 * @param existingSteps - Current array of completed steps (readonly)
 * @param newStep - Step to add
 * @returns New array with the step added (if not already present)
 */
export function addToCompletedSteps(
  existingSteps: readonly WiggumStep[],
  newStep: WiggumStep
): WiggumStep[] {
  return Array.from(new Set([...existingSteps, newStep]));
}

/**
 * Context for state reuse logging
 */
interface StateReuseContext {
  previousState: CurrentState;
  newWiggumState: WiggumState;
  prNumber?: number;
  issueNumber?: number;
}

/**
 * Log state reuse for race condition fix tracking (issue #388)
 *
 * Provides consistent structured logging when reusing state to avoid
 * race conditions with GitHub API. This logging helps track state
 * transitions during debugging and monitoring.
 *
 * @param context - State context for logging
 */
export function logStateReuse(context: StateReuseContext): void {
  const { previousState, newWiggumState, prNumber, issueNumber } = context;

  logger.info('Reusing state to avoid GitHub API race condition', {
    issueRef: '#388',
    phase: newWiggumState.phase,
    step: newWiggumState.step,
    iteration: newWiggumState.iteration,
    completedSteps: newWiggumState.completedSteps,
    prNumber,
    issueNumber,
    previousIteration: previousState.wiggum.iteration,
    previousStep: previousState.wiggum.step,
    stateTransition: `${previousState.wiggum.step} -> ${newWiggumState.step}`,
  });
}

/**
 * Apply a new wiggum state to an existing CurrentState
 *
 * Creates a new CurrentState object with the updated wiggum state while
 * preserving git, pr, and issue state. Automatically logs the state reuse.
 *
 * @param currentState - Current state to update
 * @param newWiggumState - New wiggum state to apply
 * @returns Updated CurrentState with new wiggum state
 */
export function applyWiggumState(
  currentState: CurrentState,
  newWiggumState: WiggumState
): CurrentState {
  const prNumber = currentState.pr.exists ? currentState.pr.number : undefined;
  const issueNumber = currentState.issue.exists ? currentState.issue.number : undefined;

  logStateReuse({
    previousState: currentState,
    newWiggumState,
    prNumber,
    issueNumber,
  });

  return {
    ...currentState,
    wiggum: newWiggumState,
  };
}

/**
 * Create a new WiggumState with a completed step
 *
 * Convenience function that combines state creation with step completion.
 * Handles deduplication automatically.
 *
 * @param currentState - Current wiggum state
 * @param step - Step that was completed
 * @param options - Optional overrides for iteration and phase
 * @returns New WiggumState with the step marked complete
 */
export function createCompletedStepState(
  currentState: WiggumState,
  step: WiggumStep,
  options?: {
    incrementIteration?: boolean;
    phase?: WiggumPhase;
  }
): WiggumState {
  return {
    iteration: options?.incrementIteration ? currentState.iteration + 1 : currentState.iteration,
    step,
    completedSteps: addToCompletedSteps(currentState.completedSteps, step),
    phase: options?.phase ?? currentState.phase,
    maxIterations: currentState.maxIterations,
  };
}

/**
 * Get effective max iterations for a WiggumState
 *
 * Returns the custom maxIterations value if set, otherwise returns the default (10).
 * This allows users to override the default iteration limit on a per-PR/issue basis.
 *
 * @param state - WiggumState to check
 * @returns Effective maximum iterations (custom or default)
 */
export function getEffectiveMaxIterations(state: WiggumState): number {
  return state.maxIterations ?? DEFAULT_MAX_ITERATIONS;
}

/**
 * Check if iteration limit has been reached
 *
 * Compares current iteration count against the effective max iterations
 * (which may be custom or default). Used to determine when to halt workflow
 * and request user approval for limit increase.
 *
 * @param state - WiggumState to check
 * @returns true if iteration limit reached or exceeded, false otherwise
 */
export function isIterationLimitReached(state: WiggumState): boolean {
  return state.iteration >= getEffectiveMaxIterations(state);
}
