/**
 * State management utilities for Wiggum workflow
 *
 * This module provides helper functions for common state operations:
 * - Deduplicating completed steps
 * - Logging state reuse (for race condition fix #388)
 * - Creating updated state objects
 * - Target number resolution for phase-aware tools
 */

import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { DEFAULT_MAX_ITERATIONS } from '../constants.js';
import type { WiggumStep, WiggumPhase } from '../constants.js';
import type { WiggumState, CurrentState } from './types.js';
import { createWiggumState, isIssueExists } from './types.js';

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
  const newIteration = options?.incrementIteration
    ? currentState.iteration + 1
    : currentState.iteration;

  return createWiggumState({
    iteration: newIteration,
    step,
    completedSteps: addToCompletedSteps(currentState.completedSteps, step),
    phase: options?.phase ?? currentState.phase,
    maxIterations: currentState.maxIterations,
  });
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

/**
 * Format a location string for logging based on phase and target number
 *
 * Returns "issue #N" for phase1 or "PR #N" for phase2, providing consistent
 * location formatting across all tools.
 *
 * @param phase - Current workflow phase ('phase1' or 'phase2')
 * @param targetNumber - Issue or PR number
 * @returns Formatted location string (e.g., "issue #123" or "PR #456")
 */
export function formatLocation(phase: WiggumPhase, targetNumber: number): string {
  return phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`;
}

/**
 * Get target number (issue or PR) based on current phase
 *
 * In Phase 1 (pre-PR), returns the issue number extracted from the branch name.
 * In Phase 2 (PR created), returns the PR number.
 *
 * @param state - Current state containing git, issue, and PR information
 * @param phase - Current workflow phase ('phase1' or 'phase2')
 * @param toolName - Name of the calling tool for error messages
 * @throws ValidationError if required target is missing for the phase
 */
export function getTargetNumber(state: CurrentState, phase: WiggumPhase, toolName: string): number {
  if (phase === 'phase1') {
    if (!isIssueExists(state.issue)) {
      logger.error(`${toolName} validation failed: no issue exists in Phase 1`, {
        phase,
        issueExists: state.issue.exists,
        branch: state.git.currentBranch,
      });
      throw new ValidationError(
        `No issue found. Phase 1 requires an issue number in the branch name.\n\n` +
          `Current branch: ${state.git.currentBranch}\n` +
          `Expected format: 123-feature-name (where 123 is the issue number)\n\n` +
          `To fix this:\n` +
          `1. Ensure you're working on an issue-based branch\n` +
          `2. Branch name must start with the issue number followed by a hyphen\n` +
          `3. Example: git checkout -b 282-my-feature`
      );
    }
    return state.issue.number;
  }

  if (phase === 'phase2') {
    if (!state.pr.exists || !state.pr.number) {
      logger.error(`${toolName} validation failed: no PR exists in Phase 2`, {
        phase,
        prExists: state.pr.exists,
        branch: state.git.currentBranch,
      });
      throw new ValidationError(
        `No PR found. Phase 2 requires an open pull request.\n\n` +
          `Current branch: ${state.git.currentBranch}\n\n` +
          `To fix this:\n` +
          `1. Create a PR for your branch using: gh pr create\n` +
          `2. Or use the wiggum_complete_pr_creation tool if you've just finished Phase 1\n` +
          `3. Verify PR exists with: gh pr view`
      );
    }
    return state.pr.number;
  }

  throw new ValidationError(
    `Unknown phase: ${phase}. Expected 'phase1' or 'phase2'. This indicates a workflow state corruption - please report this error.`
  );
}
