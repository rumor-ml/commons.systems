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
import { applyWiggumState } from '../state/state-utils.js';
import { advanceToNextStep } from '../state/transitions.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { buildValidationErrorMessage } from '../utils/error-messages.js';
import { STEP_ORDER, STEP_NAMES } from '../constants.js';
import type { WiggumPhase } from '../constants.js';
import type { ToolResult } from '../types.js';
import type { CurrentState, WiggumState } from '../state/types.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { readManifestFiles, getCompletedAgents, cleanupManifestFiles } from './manifest-utils.js';

/**
 * Get target number (issue or PR) based on current phase
 *
 * @throws ValidationError if required target is missing for the phase
 */
function getTargetNumber(state: CurrentState, phase: WiggumPhase): number {
  if (phase === 'phase1') {
    if (!state.issue.exists || !state.issue.number) {
      logger.error('wiggum_complete_fix validation failed: no issue exists in Phase 1', {
        phase,
        issueExists: state.issue.exists,
        branch: state.git.currentBranch,
      });
      throw new ValidationError(
        `No issue found. Phase 1 fixes require an issue number in the branch name.\n\n` +
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
      logger.error('wiggum_complete_fix validation failed: no PR exists in Phase 2', {
        phase,
        prExists: state.pr.exists,
        branch: state.git.currentBranch,
      });
      throw new ValidationError(
        `No PR found. Cannot complete fix in Phase 2.\n\n` +
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

export const CompleteFixInputSchema = z.object({
  fix_description: z.string().describe('Brief description of what was fixed'),
  has_in_scope_fixes: z
    .boolean()
    .describe(
      'Whether any in-scope fixes were made. If false, skips state update and comment posting.'
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
    // Filter to find INVALID numbers that should be rejected:
    // - !Number.isInteger(num): Rejects NaN, Infinity, -Infinity, and floats (e.g., 1.5)
    // - num <= 0: Rejects zero and negative numbers
    // Together, this filter KEEPS invalid values so we can report them as errors.
    // Valid positive integers will NOT be in this array.
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
  const targetNumber = getTargetNumber(state, phase);

  logger.info('wiggum_complete_fix started', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    iteration: state.wiggum.iteration,
    currentStep: state.wiggum.step,
    fixDescription: input.fix_description,
    hasInScopeFixes: input.has_in_scope_fixes,
  });

  // If no in-scope fixes were made, mark step complete and proceed to next step
  if (!input.has_in_scope_fixes) {
    logger.info('No in-scope fixes made - marking step complete and proceeding to next step', {
      phase,
      targetNumber,
      outOfScopeIssues: input.out_of_scope_issues,
      currentStep: state.wiggum.step,
    });

    // Mark current step as complete and advance to next step
    // Use transition helper to ensure valid state (issue #799)
    let newState = advanceToNextStep(state.wiggum);

    // Override maxIterations if provided (create new object to avoid mutating readonly)
    if (input.maxIterations !== undefined) {
      newState = { ...newState, maxIterations: input.maxIterations };
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
      // TODO(#416): Add reason-specific error guidance for different failure types
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
3. Retry by calling wiggum_complete_fix again with the same parameters`,
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
      fixDescription: input.fix_description,
      outOfScopeIssues: input.out_of_scope_issues,
      currentStep: state.wiggum.step,
      iteration: state.wiggum.iteration,
    });

    // Reuse newState to avoid race condition with GitHub API (issue #388)
    // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
    // state changes have occurred (PR closed, commits added, issue modified). This is safe
    // during inline step transitions within the same tool call. For state staleness validation,
    // see issue #391.
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

  // Read manifests and determine which agents are complete
  const manifests = readManifestFiles();
  const completedAgents = getCompletedAgents(manifests);

  logger.info('Determined completed agents from manifests', {
    completedAgents,
    manifestCount: manifests.size,
  });

  // State remains at same step but with filtered completedSteps and updated completedAgents
  const newState: WiggumState = {
    iteration: state.wiggum.iteration,
    step: state.wiggum.step,
    completedSteps: completedStepsFiltered,
    phase: state.wiggum.phase,
    maxIterations: input.maxIterations ?? state.wiggum.maxIterations,
    completedAgents,
  };

  logger.info('Posting wiggum state comment', {
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
    logger.error('Critical: State update failed (main-path) - halting workflow', {
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
3. Retry by calling wiggum_complete_fix again with the same parameters`,
            steps_completed_by_tool: [
              'Built new state with filtered completedSteps',
              `Attempted to post state comment - FAILED (${stateResult.reason})`,
              'State NOT modified on GitHub',
              'NO fix description comment posted (state update failed first)',
              'Action required: Retry wiggum_complete_fix to post both comments',
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
  // This ensures manifests are scoped to a single iteration
  await cleanupManifestFiles();

  // Reuse newState instead of calling detectCurrentState() again to avoid race condition
  // with GitHub API (issue #388). When we just updated the PR/issue body, the API may not
  // immediately return the updated state due to eventual consistency.
  //
  // TRADE-OFF: This is safe because we're within a single tool call and assume no external
  // changes (PR closed, commits added) occurred during execution. For cross-tool-call state
  // validation where staleness is a concern, see issue #391.
  const updatedState = applyWiggumState(state, newState);
  const nextStepResult = await getNextStepInstructions(updatedState);

  logger.info('wiggum_complete_fix completed successfully', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    nextStepResultLength: JSON.stringify(nextStepResult).length,
  });

  return nextStepResult;
}
