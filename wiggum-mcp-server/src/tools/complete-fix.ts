/**
 * Tool: wiggum_complete_fix
 *
 * Called after completing a Plan+Fix cycle
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { postWiggumStateComment } from '../state/comments.js';
import { postWiggumStateIssueComment } from '../state/issue-comments.js';
import { getNextStepInstructions } from '../state/router.js';
import { applyWiggumState } from '../state/state-utils.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { STEP_ORDER } from '../constants.js';
import type { WiggumPhase } from '../constants.js';
import type { ToolResult } from '../types.js';
import type { CurrentState, WiggumState } from '../state/types.js';

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
      `fix_description is required and cannot be empty. Received: ${JSON.stringify(input.fix_description)} (type: ${typeof input.fix_description}, length: ${input.fix_description?.length ?? 0}). Please provide a meaningful description of what was fixed.`
    );
  }

  // Validate out_of_scope_issues array contents if provided
  if (input.out_of_scope_issues && input.out_of_scope_issues.length > 0) {
    const invalidNumbers = input.out_of_scope_issues.filter(
      (num) => !Number.isFinite(num) || num <= 0 || !Number.isInteger(num)
    );
    if (invalidNumbers.length > 0) {
      logger.error('wiggum_complete_fix validation failed: invalid out_of_scope_issues', {
        invalidNumbers,
      });
      throw new ValidationError(
        `Invalid issue numbers in out_of_scope_issues: ${invalidNumbers.join(', ')}. All issue numbers must be positive integers.`
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

    // Mark current step as complete (without incrementing iteration)
    // This allows the router to advance to the next step
    const newState = {
      iteration: state.wiggum.iteration, // Keep iteration unchanged
      step: state.wiggum.step,
      completedSteps: [...state.wiggum.completedSteps, state.wiggum.step],
      phase: state.wiggum.phase,
    };

    // Post minimal state comment documenting fast-path completion
    const commentTitle = `${state.wiggum.step} - Complete (No In-Scope Fixes)`;
    const outOfScopeSection = input.out_of_scope_issues?.length
      ? `\n\nOut-of-scope recommendations tracked in: ${input.out_of_scope_issues.map((n) => `#${n}`).join(', ')}`
      : '';
    const commentBody = `**Fix Description:** ${input.fix_description}${outOfScopeSection}`;

    logger.info('Posting wiggum state comment (fast-path)', {
      phase,
      targetNumber,
      location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
      newState,
    });

    // Post comment to appropriate location based on phase
    if (phase === 'phase1') {
      await postWiggumStateIssueComment(targetNumber, newState, commentTitle, commentBody);
    } else {
      await postWiggumStateComment(targetNumber, newState, commentTitle, commentBody);
    }

    logger.info('Fast-path state comment posted successfully', {
      phase,
      targetNumber,
      location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    });

    // Reuse newState to avoid race condition with GitHub API (issue #388)
    // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
    // state changes have occurred (PR closed, commits added, issue modified). This is safe
    // during inline step transitions within the same tool call. For state staleness validation,
    // see issue #391.
    const updatedState = applyWiggumState(state, newState);
    return await getNextStepInstructions(updatedState);
  }

  // Post comment documenting the fix (to issue in Phase 1, to PR in Phase 2)
  const commentTitle = `Fix Applied (Iteration ${state.wiggum.iteration})`;
  const outOfScopeSection = input.out_of_scope_issues?.length
    ? `\n\n**Out-of-Scope Recommendations:**\nTracked in: ${input.out_of_scope_issues.map((n) => `#${n}`).join(', ')}`
    : '';
  const commentBody = `**Fix Description:**

${input.fix_description}${outOfScopeSection}

**Next Action:** Restarting workflow monitoring to verify fix.`;

  // Clear the current step and all subsequent steps from completedSteps
  // This ensures we re-verify from the point where issues were found, preventing
  // the workflow from skipping validation steps after a fix is applied
  // TODO: See issue #334 - Add integration tests for completedSteps filtering
  const currentStepIndex = STEP_ORDER.indexOf(state.wiggum.step);

  logger.info('Filtering completed steps', {
    currentStep: state.wiggum.step,
    currentStepIndex,
    completedStepsBefore: state.wiggum.completedSteps,
  });

  // TODO: See issue #334 - Add validation for unknown steps in filter
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

  // State remains at same step but with filtered completedSteps
  const newState: WiggumState = {
    iteration: state.wiggum.iteration,
    step: state.wiggum.step,
    completedSteps: completedStepsFiltered,
    phase: state.wiggum.phase,
  };

  logger.info('Posting wiggum state comment', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    newState,
  });

  // Post comment to appropriate location based on phase
  if (phase === 'phase1') {
    await postWiggumStateIssueComment(targetNumber, newState, commentTitle, commentBody);
  } else {
    await postWiggumStateComment(targetNumber, newState, commentTitle, commentBody);
  }

  logger.info('Wiggum state comment posted successfully', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
  });

  // Reuse newState to avoid race condition with GitHub API (issue #388)
  // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
  // state changes have occurred (PR closed, commits added, issue modified). This is safe
  // during inline step transitions within the same tool call. For state staleness validation,
  // see issue #391.
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
