/**
 * Tool: wiggum_complete_all_hands
 *
 * Called after all /all-hands-review agents complete (both review and implementation).
 * Reads manifests internally, applies 2-strike logic, and returns next step instructions.
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import {
  getNextStepInstructions,
  safeUpdatePRBodyState,
  safeUpdateIssueBodyState,
} from '../state/router.js';
import { applyWiggumState, formatLocation, getTargetNumber } from '../state/state-utils.js';
import { advanceToNextStep } from '../state/transitions.js';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types.js';
import type { WiggumState } from '../state/types.js';
import { createWiggumState } from '../state/types.js';
import { buildStateUpdateFailureResponse } from '../utils/state-update-error.js';
import {
  readManifestFiles,
  cleanupManifestFiles,
  safeCleanupManifestFiles,
  countHighPriorityInScopeIssues,
} from './manifest-utils.js';

export const CompleteAllHandsInputSchema = z.object({
  maxIterations: z
    .number()
    .int()
    .positive('maxIterations must be a positive integer')
    .optional()
    .describe(
      'Optional custom iteration limit. Use when user approves increasing the limit beyond default.'
    ),
});

export type CompleteAllHandsInput = z.infer<typeof CompleteAllHandsInputSchema>;

/**
 * Complete all-hands review cycle and update state
 *
 * Reads manifests internally to count high-priority in-scope issues.
 * If no high-priority issues remain, advances to next step.
 * If issues remain, increments iteration and returns instructions to continue.
 *
 * NOTE: This function shares patterns with complete-fix.ts including:
 * - Manifest reading and high-priority issue counting
 * - Fast-path state update when no high-priority issues
 * - State persistence with error handling
 * See code-simplifier-in-scope-3 for potential future refactoring.
 */
export async function completeAllHands(input: CompleteAllHandsInput): Promise<ToolResult> {
  const state = await detectCurrentState();

  const phase = state.wiggum.phase;
  const targetNumber = getTargetNumber(state, phase, 'wiggum_complete_all_hands');

  logger.info('wiggum_complete_all_hands started', {
    phase,
    targetNumber,
    location: formatLocation(phase, targetNumber),
    iteration: state.wiggum.iteration,
    currentStep: state.wiggum.step,
  });

  // Read manifests to determine current state
  const manifests = readManifestFiles();

  // Determine if there are any high-priority in-scope issues remaining
  const totalHighPriorityIssues = countHighPriorityInScopeIssues(manifests);

  logger.info('Manifest analysis complete', {
    totalHighPriorityIssues,
    totalManifests: manifests.size,
  });

  // If no high-priority in-scope issues remain, mark step complete and proceed
  if (totalHighPriorityIssues === 0) {
    logger.info('No high-priority issues - marking step complete and proceeding to next step', {
      phase,
      targetNumber,
      currentStep: state.wiggum.step,
    });

    // Mark current step as complete and advance to next step
    let newState = advanceToNextStep(state.wiggum);

    // Override maxIterations if provided
    if (input.maxIterations !== undefined) {
      newState = { ...newState, maxIterations: input.maxIterations };
    }

    // Clean up manifest files BEFORE state persistence in fast-path
    // Must use throwing version here because cleanup happens BEFORE state is persisted.
    // If cleanup fails silently, stale manifests would corrupt agent completion tracking
    // on next iteration (see manifest-utils.ts for detailed error handling).
    await cleanupManifestFiles();

    logger.info('Updating wiggum state (fast-path)', {
      phase,
      targetNumber,
      location: formatLocation(phase, targetNumber),
      newState,
    });

    // Update state in appropriate location based on phase
    const stateResult =
      phase === 'phase1'
        ? await safeUpdateIssueBodyState(targetNumber, newState, state.wiggum.step)
        : await safeUpdatePRBodyState(targetNumber, newState, state.wiggum.step);

    if (!stateResult.success) {
      return buildStateUpdateFailureResponse({
        state,
        stateResult,
        newState,
        phase,
        stepsCompleted: [
          'Built new state locally (NOT persisted)',
          `Attempted to post state comment - FAILED (${stateResult.reason})`,
          'State NOT modified on GitHub',
          'Action required: Retry after resolving the issue',
        ],
        toolName: 'wiggum_complete_all_hands',
      });
    }

    logger.info('Fast-path state comment posted successfully', {
      phase,
      targetNumber,
      location: formatLocation(phase, targetNumber),
      currentStep: state.wiggum.step,
      iteration: state.wiggum.iteration,
    });

    // Reuse newState to avoid race condition with GitHub API
    const updatedState = applyWiggumState(state, newState);
    return await getNextStepInstructions(updatedState);
  }

  // There are still high-priority issues remaining
  // Increment iteration and update state
  // Each completion call represents one iteration cycle (review + fix)
  const newState: WiggumState = createWiggumState({
    iteration: state.wiggum.iteration + 1,
    step: state.wiggum.step,
    completedSteps: state.wiggum.completedSteps,
    phase: state.wiggum.phase,
    maxIterations: input.maxIterations ?? state.wiggum.maxIterations,
  });

  logger.info('Posting wiggum state comment', {
    phase,
    targetNumber,
    location: formatLocation(phase, targetNumber),
    newState,
  });

  // Update state in appropriate location based on phase
  const stateResult =
    phase === 'phase1'
      ? await safeUpdateIssueBodyState(targetNumber, newState, state.wiggum.step)
      : await safeUpdatePRBodyState(targetNumber, newState, state.wiggum.step);

  if (!stateResult.success) {
    return buildStateUpdateFailureResponse({
      state,
      stateResult,
      newState,
      phase,
      stepsCompleted: [
        'Built new state with updated agent tracking',
        `Attempted to post state comment - FAILED (${stateResult.reason})`,
        'State NOT modified on GitHub',
        'Action required: Retry wiggum_complete_all_hands to post state',
      ],
      toolName: 'wiggum_complete_all_hands',
    });
  }

  logger.info('Wiggum state comment posted successfully', {
    phase,
    targetNumber,
    location: formatLocation(phase, targetNumber),
  });

  // Clean up manifest files after successful state update
  // Use SAFE version because state is already persisted to GitHub.
  // Unlike fast-path (line 127) where cleanup happens BEFORE state persistence,
  // here the state is already committed. Cleanup failure should:
  // - Log a warning but NOT block workflow progression
  // - Allow user to manually clean up tmp/wiggum/*.json if needed
  // - Avoid creating inconsistent state (persisted state + thrown error)
  await safeCleanupManifestFiles();

  // Reuse newState instead of calling detectCurrentState() again to avoid race condition
  const updatedState = applyWiggumState(state, newState);
  const nextStepResult = await getNextStepInstructions(updatedState);

  logger.info('wiggum_complete_all_hands completed successfully', {
    phase,
    targetNumber,
    location: formatLocation(phase, targetNumber),
    nextStepResultLength: JSON.stringify(nextStepResult).length,
  });

  return nextStepResult;
}
