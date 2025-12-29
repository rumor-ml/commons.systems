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
import { applyWiggumState, getTargetNumber } from '../state/state-utils.js';
import { advanceToNextStep } from '../state/transitions.js';
import { logger } from '../utils/logger.js';
import { STEP_NAMES } from '../constants.js';
import type { ToolResult } from '../types.js';
import type { WiggumState, CurrentState } from '../state/types.js';
import { createWiggumState } from '../state/types.js';
import type { WiggumPhase } from '../constants.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import {
  readManifestFiles,
  cleanupManifestFiles,
  updateAgentCompletionStatus,
  countHighPriorityInScopeIssues,
} from './manifest-utils.js';

/**
 * Build a standardized error response for state update failures
 */
function buildStateUpdateFailureResponse(
  state: CurrentState,
  stateResult: { success: false; reason: string },
  newState: WiggumState,
  phase: WiggumPhase,
  stepsCompleted: string[]
): ToolResult {
  logger.error('Critical: State update failed - halting workflow', {
    targetNumber: getTargetNumber(state, phase, 'wiggum_complete_all_hands'),
    phase,
    step: state.wiggum.step,
    reason: stateResult.reason,
    impact: 'Race condition fix requires state persistence',
  });

  return {
    content: [
      {
        type: 'text',
        text: formatWiggumResponse({
          current_step: STEP_NAMES[state.wiggum.step],
          step_number: state.wiggum.step,
          iteration_count: newState.iteration,
          instructions: `ERROR: Failed to post state comment due to ${stateResult.reason}.

**IMPORTANT: Your workflow state has NOT been modified.**
You are still on: ${STEP_NAMES[state.wiggum.step]}

The race condition fix requires state persistence to GitHub.

Common causes:
- GitHub API rate limiting: Check \`gh api rate_limit\`
- Network connectivity issues

To resolve:
1. Check rate limits: \`gh api rate_limit\`
2. Verify network connectivity
3. Retry by calling wiggum_complete_all_hands again with the same parameters`,
          steps_completed_by_tool: stepsCompleted,
          context: {
            pr_number: phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
            issue_number: phase === 'phase1' && state.issue.exists ? state.issue.number : undefined,
          },
        }),
      },
    ],
    isError: true,
  };
}

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
 * Reads manifests internally to determine agent completion status.
 * Uses 2-strike verification logic to mark agents complete.
 * If all agents complete (0 high-priority in-scope issues), advances to next step.
 * If agents have issues remaining, returns instructions to continue iteration.
 */
export async function completeAllHands(input: CompleteAllHandsInput): Promise<ToolResult> {
  const state = await detectCurrentState();

  const phase = state.wiggum.phase;
  const targetNumber = getTargetNumber(state, phase, 'wiggum_complete_all_hands');

  logger.info('wiggum_complete_all_hands started', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    iteration: state.wiggum.iteration,
    currentStep: state.wiggum.step,
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
        currentStep: state.wiggum.step,
        completedAgents,
        pendingCompletionAgents,
      }
    );

    // Mark current step as complete and advance to next step
    let newState = advanceToNextStep(state.wiggum);

    // Override maxIterations if provided
    if (input.maxIterations !== undefined) {
      newState = { ...newState, maxIterations: input.maxIterations };
    }

    // Update agent tracking
    newState = {
      ...newState,
      completedAgents,
      pendingCompletionAgents,
    };

    // Clean up manifest files after successful step completion
    // Cleanup failures are non-fatal - state persistence is what matters
    try {
      await cleanupManifestFiles();
    } catch (cleanupError) {
      logger.warn('Failed to clean up manifest files - continuing anyway', {
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        impact: 'Old manifest files may accumulate in tmp/wiggum',
        recommendation: 'Manually delete tmp/wiggum/*.json files if needed',
      });
      // Continue - cleanup failure is not critical for workflow correctness
    }

    logger.info('Updating wiggum state (fast-path)', {
      phase,
      targetNumber,
      location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
      newState,
    });

    // Update state in appropriate location based on phase
    const stateResult =
      phase === 'phase1'
        ? await safeUpdateIssueBodyState(targetNumber, newState, state.wiggum.step)
        : await safeUpdatePRBodyState(targetNumber, newState, state.wiggum.step);

    if (!stateResult.success) {
      return buildStateUpdateFailureResponse(state, stateResult, newState, phase, [
        'Built new state locally (NOT persisted)',
        `Attempted to post state comment - FAILED (${stateResult.reason})`,
        'State NOT modified on GitHub',
        'Action required: Retry after resolving the issue',
      ]);
    }

    logger.info('Fast-path state comment posted successfully', {
      phase,
      targetNumber,
      location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
      currentStep: state.wiggum.step,
      iteration: state.wiggum.iteration,
    });

    // Reuse newState to avoid race condition with GitHub API
    const updatedState = applyWiggumState(state, newState);
    return await getNextStepInstructions(updatedState);
  }

  // There are still high-priority issues remaining
  // Update state with new agent tracking and return instructions to continue
  const newState: WiggumState = createWiggumState({
    iteration: state.wiggum.iteration,
    step: state.wiggum.step,
    completedSteps: state.wiggum.completedSteps,
    phase: state.wiggum.phase,
    maxIterations: input.maxIterations ?? state.wiggum.maxIterations,
    completedAgents,
    pendingCompletionAgents,
  });

  logger.info('Posting wiggum state comment with updated agent tracking', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    newState,
  });

  // Update state in appropriate location based on phase
  const stateResult =
    phase === 'phase1'
      ? await safeUpdateIssueBodyState(targetNumber, newState, state.wiggum.step)
      : await safeUpdatePRBodyState(targetNumber, newState, state.wiggum.step);

  if (!stateResult.success) {
    return buildStateUpdateFailureResponse(state, stateResult, newState, phase, [
      'Built new state with updated agent tracking',
      `Attempted to post state comment - FAILED (${stateResult.reason})`,
      'State NOT modified on GitHub',
      'Action required: Retry wiggum_complete_all_hands to post state',
    ]);
  }

  logger.info('Wiggum state comment posted successfully', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
  });

  // Clean up manifest files after successful state update
  // Cleanup failures are non-fatal - state is already persisted to GitHub
  try {
    await cleanupManifestFiles();
  } catch (cleanupError) {
    logger.warn('Failed to clean up manifest files - continuing anyway', {
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      impact: 'Old manifest files may accumulate in tmp/wiggum',
      recommendation: 'Manually delete tmp/wiggum/*.json files if needed',
    });
    // Continue - cleanup failure is not critical for workflow correctness
  }

  // Reuse newState instead of calling detectCurrentState() again to avoid race condition
  const updatedState = applyWiggumState(state, newState);
  const nextStepResult = await getNextStepInstructions(updatedState);

  logger.info('wiggum_complete_all_hands completed successfully', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    nextStepResultLength: JSON.stringify(nextStepResult).length,
  });

  return nextStepResult;
}
