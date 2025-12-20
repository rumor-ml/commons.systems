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
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { STEP_ORDER } from '../constants.js';
import type { ToolResult } from '../types.js';

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
    logger.error('wiggum_complete_fix validation failed: empty fix_description');
    // TODO: See issue #312 - Add Sentry error ID for tracking
    throw new ValidationError('fix_description is required and cannot be empty');
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
      // TODO: See issue #312 - Add Sentry error ID for tracking
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

  // Validate state and get target number based on current phase
  let targetNumber: number;

  if (phase === 'phase1') {
    if (!state.issue.exists || !state.issue.number) {
      logger.error('wiggum_complete_fix validation failed: no issue exists in Phase 1', {
        phase,
        issueExists: state.issue.exists,
        branch: state.git.currentBranch,
      });
      // TODO: See issue #312 - Add Sentry error ID for tracking
      throw new ValidationError(
        'No issue found. Phase 1 fixes require issue number in branch name (format: 123-feature-name).'
      );
    }
    // TODO: See issue #292 - Remove redundant type narrowing comments throughout codebase
    // After validation, we know state.issue.number exists
    targetNumber = state.issue.number as number;
  } else if (phase === 'phase2') {
    if (!state.pr.exists || !state.pr.number) {
      logger.error('wiggum_complete_fix validation failed: no PR exists in Phase 2', {
        phase,
        prExists: state.pr.exists,
        branch: state.git.currentBranch,
      });
      // TODO: See issue #312 - Add Sentry error ID for tracking
      throw new ValidationError('No PR found. Cannot complete fix in Phase 2.');
    }
    // After validation, we know state.pr.number exists
    targetNumber = state.pr.number as number;
  } else {
    // TODO: See issue #312 - Add Sentry error ID for tracking
    throw new ValidationError(`Unknown phase: ${phase}`);
  }

  logger.info('wiggum_complete_fix started', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    iteration: state.wiggum.iteration,
    currentStep: state.wiggum.step,
    fixDescription: input.fix_description,
    hasInScopeFixes: input.has_in_scope_fixes,
  });

  // If no in-scope fixes were made, skip state update and proceed to next step
  if (!input.has_in_scope_fixes) {
    logger.info('No in-scope fixes made - proceeding to next step without state update', {
      phase,
      targetNumber,
      outOfScopeIssues: input.out_of_scope_issues,
    });

    const updatedState = await detectCurrentState();
    return await getNextStepInstructions(updatedState);
  }

  // Post comment documenting the fix (to issue in Phase 1, to PR in Phase 2)
  const commentTitle = `Fix Applied (Iteration ${state.wiggum.iteration})`;
  // TODO: See issue #296 - Use optional chaining for cleaner code
  const outOfScopeSection =
    input.out_of_scope_issues && input.out_of_scope_issues.length > 0
      ? `\n\n**Out-of-Scope Recommendations:**\nTracked in: ${input.out_of_scope_issues.map((n) => `#${n}`).join(', ')}`
      : '';
  const commentBody = `**Fix Description:**

${input.fix_description}${outOfScopeSection}

**Next Action:** Restarting workflow monitoring to verify fix.`;

  // Clear the current step and all subsequent steps from completedSteps
  // This ensures we re-verify from the point where issues were found, preventing
  // the workflow from skipping validation steps after a fix is applied
  const currentStepIndex = STEP_ORDER.indexOf(state.wiggum.step);

  logger.info('Filtering completed steps', {
    currentStep: state.wiggum.step,
    currentStepIndex,
    completedStepsBefore: state.wiggum.completedSteps,
  });

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
  const newState = {
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

  // Get updated state and return next step instructions
  // The router will re-verify from the current step since we cleared completedSteps
  logger.info('Detecting updated state and getting next step instructions');
  const updatedState = await detectCurrentState();

  logger.info('Updated state detected', {
    iteration: updatedState.wiggum.iteration,
    step: updatedState.wiggum.step,
    completedSteps: updatedState.wiggum.completedSteps,
  });

  const nextStepResult = await getNextStepInstructions(updatedState);

  logger.info('wiggum_complete_fix completed successfully', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    nextStepResultLength: JSON.stringify(nextStepResult).length,
  });

  return nextStepResult;
}
