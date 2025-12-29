/**
 * Tool: wiggum_complete_fix
 *
 * Called after completing a Plan+Fix cycle
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
import { ValidationError } from '../utils/errors.js';
import { buildValidationErrorMessage } from '../utils/error-messages.js';
import { STEP_ORDER } from '../constants.js';
import type { ToolResult } from '../types.js';
import type { WiggumState } from '../state/types.js';
import { createWiggumState } from '../state/types.js';
import { buildStateUpdateFailureResponse } from '../utils/state-update-error.js';
import {
  readManifestFiles,
  cleanupManifestFiles,
  updateAgentCompletionStatus,
  countHighPriorityInScopeIssues,
} from './manifest-utils.js';

export const CompleteFixInputSchema = z.object({
  fix_description: z.string().describe('Brief description of what was fixed'),
  has_in_scope_fixes: z
    .boolean()
    .optional()
    .describe(
      'DEPRECATED: Tool now reads manifests to determine fix status automatically. This parameter is no longer used in the logic but is kept for backward compatibility. Will be removed in a future version.'
    ),
  out_of_scope_issues: z
    .array(z.number())
    .optional()
    .describe('List of issue numbers for out-of-scope recommendations (both new and existing)'),
  maxIterations: z
    .number()
    .int()
    .positive('maxIterations must be a positive integer')
    .optional()
    .describe(
      'Optional custom iteration limit. Use when user approves increasing the limit beyond default.'
    ),
});

export type CompleteFixInput = z.infer<typeof CompleteFixInputSchema>;

/**
 * Complete a fix cycle and update state
 *
 * NOTE: This function shares patterns with complete-all-hands.ts including:
 * - Manifest reading and agent completion status update
 * - Fast-path state update when no high-priority issues
 * - State persistence with error handling
 * See code-simplifier-in-scope-3 for potential future refactoring.
 */
export async function completeFix(input: CompleteFixInput): Promise<ToolResult> {
  if (!input.fix_description || input.fix_description.trim().length === 0) {
    logger.error('wiggum_complete_fix validation failed: empty fix_description', {
      receivedValue: input.fix_description,
      valueType: typeof input.fix_description,
      valueLength: input.fix_description?.length ?? 0,
    });
    throw new ValidationError(
      buildValidationErrorMessage({
        problem: 'fix_description is required and cannot be empty',
        context: `Received: ${JSON.stringify(input.fix_description)} (type: ${typeof input.fix_description}, length: ${input.fix_description?.length ?? 0})`,
        expected: 'Non-empty string describing what was fixed (1-2 sentences)',
        remediation: [
          'Provide a meaningful description of what you fixed',
          'Example: "Fixed authentication bug in login flow"',
          'Example: "Updated error handling to classify GitHub API failures"',
          'Keep it concise and focused on the changes made',
        ],
      })
    );
  }

  // Validate out_of_scope_issues array contents if provided
  if (input.out_of_scope_issues && input.out_of_scope_issues.length > 0) {
    // Collect invalid values (non-positive-integers) to report in error message
    const invalidNumbers = input.out_of_scope_issues.filter(
      (num) => !Number.isInteger(num) || num <= 0
    );
    if (invalidNumbers.length > 0) {
      logger.error('wiggum_complete_fix validation failed: invalid out_of_scope_issues', {
        invalidNumbers,
      });
      // TODO(#312): Add Sentry error ID for tracking
      throw new ValidationError(
        buildValidationErrorMessage({
          problem: 'Invalid issue numbers in out_of_scope_issues array',
          context: `Found invalid values: ${invalidNumbers.map((n) => `${n} (type: ${typeof n})`).join(', ')}`,
          expected: 'Array of positive integers representing GitHub issue numbers',
          remediation: [
            'Ensure all issue numbers are positive integers (e.g., [123, 456])',
            'Remove any non-numeric values from the array',
            'Remove any zero, negative, or decimal numbers',
            'Example: out_of_scope_issues: [123, 456, 789]',
          ],
        })
      );
    }

    logger.info('Tracking out-of-scope issues', {
      outOfScopeIssues: input.out_of_scope_issues,
      count: input.out_of_scope_issues.length,
    });
  }

  const state = await detectCurrentState();

  const phase = state.wiggum.phase;
  const targetNumber = getTargetNumber(state, phase, 'wiggum_complete_fix');

  logger.info('wiggum_complete_fix started', {
    phase,
    targetNumber,
    location: formatLocation(phase, targetNumber),
    iteration: state.wiggum.iteration,
    currentStep: state.wiggum.step,
    fixDescription: input.fix_description,
    ...(input.has_in_scope_fixes !== undefined && {
      hasInScopeFixes_DEPRECATED: input.has_in_scope_fixes,
      deprecationNote:
        'has_in_scope_fixes parameter is deprecated - using manifest-based detection',
    }),
  });

  // Read manifests to determine current state
  const manifests = readManifestFiles();

  // Update agent completion status using 2-strike logic
  const { completedAgents, pendingCompletionAgents } = updateAgentCompletionStatus(
    manifests,
    state.wiggum.pendingCompletionAgents ?? [],
    state.wiggum.completedAgents ?? []
  );

  // Determine if there are any high-priority in-scope issues remaining
  const totalHighPriorityIssues = countHighPriorityInScopeIssues(manifests);

  logger.info('Manifest analysis complete', {
    totalHighPriorityIssues,
    completedAgents,
    pendingCompletionAgents,
    totalManifests: manifests.size,
  });

  // If no high-priority in-scope issues remain, mark step complete and proceed to next step
  if (totalHighPriorityIssues === 0) {
    logger.info(
      'No high-priority in-scope issues - marking step complete and proceeding to next step',
      {
        phase,
        targetNumber,
        outOfScopeIssues: input.out_of_scope_issues,
        currentStep: state.wiggum.step,
        completedAgents,
        pendingCompletionAgents,
      }
    );

    // Mark current step as complete and advance to next step
    // Use transition helper to ensure valid state (issue #799)
    let newState = advanceToNextStep(state.wiggum);

    // Override maxIterations if provided (create new object to avoid mutating readonly)
    if (input.maxIterations !== undefined) {
      newState = { ...newState, maxIterations: input.maxIterations };
    }

    // Clean up manifest files after successful step completion
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
      // TODO(#416): Add reason-specific error guidance for different failure types
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
        toolName: 'wiggum_complete_fix',
      });
    }

    logger.info('Fast-path state comment posted successfully', {
      phase,
      targetNumber,
      location: formatLocation(phase, targetNumber),
      fixDescription: input.fix_description,
      outOfScopeIssues: input.out_of_scope_issues,
      currentStep: state.wiggum.step,
      iteration: state.wiggum.iteration,
    });

    // Reuse newState to avoid race condition with GitHub API (issue #388).
    // The GitHub API may not immediately return updated state due to eventual consistency.
    //
    // TRADE-OFF: This avoids eventual consistency issues but assumes no external state changes
    // (PR closed, commits added, issue modified) occurred during execution. This is safe because
    // we're within a single synchronous code path - no async operations between state update and
    // reuse that could allow external changes.
    //
    // WARNING: If this code is refactored to add async operations (network calls, file I/O) between
    // the state update above and the state reuse below, this optimization becomes unsafe and you
    // must re-detect state or add validation per issue #391.
    const updatedState = applyWiggumState(state, newState);
    return await getNextStepInstructions(updatedState);
  }

  // Clear the current step and all subsequent steps from completedSteps
  // This ensures we re-verify from the point where issues were found, preventing
  // the workflow from skipping validation steps after a fix is applied
  // TODO(#334): Add integration tests for completedSteps filtering
  const currentStepIndex = STEP_ORDER.indexOf(state.wiggum.step);

  logger.info('Filtering completed steps', {
    currentStep: state.wiggum.step,
    currentStepIndex,
    completedStepsBefore: state.wiggum.completedSteps,
  });

  // TODO(#377): Add validation for unknown steps in filter
  const completedStepsFiltered = state.wiggum.completedSteps.filter((step) => {
    const stepIndex = STEP_ORDER.indexOf(step);
    return stepIndex < currentStepIndex;
  });

  logger.info('Completed steps filtered', {
    completedStepsAfter: completedStepsFiltered,
    removedSteps: state.wiggum.completedSteps.filter(
      (step) => !completedStepsFiltered.includes(step)
    ),
  });

  // State remains at same step but with filtered completedSteps and updated agent tracking
  const newState: WiggumState = createWiggumState({
    iteration: state.wiggum.iteration,
    step: state.wiggum.step,
    completedSteps: completedStepsFiltered,
    phase: state.wiggum.phase,
    maxIterations: input.maxIterations ?? state.wiggum.maxIterations,
    completedAgents,
    pendingCompletionAgents,
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
        'Built new state with filtered completedSteps',
        `Attempted to post state comment - FAILED (${stateResult.reason})`,
        'State NOT modified on GitHub',
        'NO fix description comment posted (state update failed first)',
        'Action required: Retry wiggum_complete_fix to post both comments',
      ],
      toolName: 'wiggum_complete_fix',
    });
  }

  logger.info('Wiggum state comment posted successfully', {
    phase,
    targetNumber,
    location: formatLocation(phase, targetNumber),
  });

  // Clean up manifest files after successful state update
  // This ensures manifests are scoped to a single iteration
  await cleanupManifestFiles();

  // Reuse newState to avoid race condition with GitHub API (issue #388).
  // The GitHub API may not immediately return updated state due to eventual consistency.
  //
  // TRADE-OFF: This avoids eventual consistency issues but assumes no external state changes
  // (PR closed, commits added, issue modified) occurred during execution. This is safe because
  // we're within a single synchronous code path - no async operations between state update and
  // reuse that could allow external changes.
  //
  // WARNING: If this code is refactored to add async operations (network calls, file I/O) between
  // the state update above and the state reuse below, this optimization becomes unsafe and you
  // must re-detect state or add validation per issue #391.
  const updatedState = applyWiggumState(state, newState);
  const nextStepResult = await getNextStepInstructions(updatedState);

  logger.info('wiggum_complete_fix completed successfully', {
    phase,
    targetNumber,
    location: formatLocation(phase, targetNumber),
    nextStepResultLength: JSON.stringify(nextStepResult).length,
  });

  return nextStepResult;
}
