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
import { applyWiggumState } from '../state/state-utils.js';
import { advanceToNextStep } from '../state/transitions.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { STEP_NAMES } from '../constants.js';
import type { WiggumPhase } from '../constants.js';
import type { ToolResult } from '../types.js';
import type { CurrentState, WiggumState } from '../state/types.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import {
  readManifestFiles,
  cleanupManifestFiles,
  updateAgentCompletionStatus,
} from './manifest-utils.js';

/**
 * Get target number (issue or PR) based on current phase
 *
 * @throws ValidationError if required target is missing for the phase
 */
function getTargetNumber(state: CurrentState, phase: WiggumPhase): number {
  if (phase === 'phase1') {
    if (!state.issue.exists || !state.issue.number) {
      logger.error('wiggum_complete_all_hands validation failed: no issue exists in Phase 1', {
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
      logger.error('wiggum_complete_all_hands validation failed: no PR exists in Phase 2', {
        phase,
        prExists: state.pr.exists,
        branch: state.git.currentBranch,
      });
      throw new ValidationError(
        `No PR found. Cannot complete all-hands review in Phase 2.\n\n` +
          `Current branch: ${state.git.currentBranch}\n` +
          `Phase 2 requires an open pull request.\n\n` +
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
  const targetNumber = getTargetNumber(state, phase);

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
  let totalHighPriorityIssues = 0;
  for (const [key, manifest] of manifests.entries()) {
    if (key.endsWith('-in-scope')) {
      totalHighPriorityIssues += manifest.high_priority_count;
    }
  }

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
    await cleanupManifestFiles();

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
      logger.error('Critical: State update failed (fast-path) - halting workflow', {
        targetNumber,
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

**IMPORTANT: Your workflow state has NOT been modified.** The step has NOT been marked complete.
You are still on: ${STEP_NAMES[state.wiggum.step]}

The race condition fix requires state persistence to GitHub.

Common causes:
- GitHub API rate limiting: Check \`gh api rate_limit\`
- Network connectivity issues

To resolve:
1. Check rate limits: \`gh api rate_limit\`
2. Verify network connectivity
3. Retry by calling wiggum_complete_all_hands again with the same parameters`,
              steps_completed_by_tool: [
                'Built new state locally (NOT persisted)',
                `Attempted to post state comment - FAILED (${stateResult.reason})`,
                'State NOT modified on GitHub',
                'Action required: Retry after resolving the issue',
              ],
              context: {
                pr_number: phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
                issue_number:
                  phase === 'phase1' && state.issue.exists ? state.issue.number : undefined,
              },
            }),
          },
        ],
        isError: true,
      };
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
  const newState: WiggumState = {
    iteration: state.wiggum.iteration,
    step: state.wiggum.step,
    completedSteps: state.wiggum.completedSteps,
    phase: state.wiggum.phase,
    maxIterations: input.maxIterations ?? state.wiggum.maxIterations,
    completedAgents,
    pendingCompletionAgents,
  };

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
    logger.error('Critical: State update failed - halting workflow', {
      targetNumber,
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
            steps_completed_by_tool: [
              'Built new state with updated agent tracking',
              `Attempted to post state comment - FAILED (${stateResult.reason})`,
              'State NOT modified on GitHub',
              'Action required: Retry wiggum_complete_all_hands to post state',
            ],
            context: {
              pr_number: phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
              issue_number:
                phase === 'phase1' && state.issue.exists ? state.issue.number : undefined,
            },
          }),
        },
      ],
      isError: true,
    };
  }

  logger.info('Wiggum state comment posted successfully', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
  });

  // Clean up manifest files after successful state update
  await cleanupManifestFiles();

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
