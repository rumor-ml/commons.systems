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
});

export type CompleteFixInput = z.infer<typeof CompleteFixInputSchema>;

/**
 * Complete a fix cycle and update state
 */
export async function completeFix(input: CompleteFixInput): Promise<ToolResult> {
  if (!input.fix_description || input.fix_description.trim().length === 0) {
    logger.error('wiggum_complete_fix validation failed: empty fix_description');
    throw new ValidationError('fix_description is required and cannot be empty');
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
      throw new ValidationError(
        'No issue found. Phase 1 fixes require issue number in branch name (format: 123-feature-name).'
      );
    }
    // After validation, we know state.issue.number exists
    targetNumber = state.issue.number as number;
  } else if (phase === 'phase2') {
    if (!state.pr.exists || !state.pr.number) {
      logger.error('wiggum_complete_fix validation failed: no PR exists in Phase 2', {
        phase,
        prExists: state.pr.exists,
        branch: state.git.currentBranch,
      });
      throw new ValidationError('No PR found. Cannot complete fix in Phase 2.');
    }
    // After validation, we know state.pr.number exists
    targetNumber = state.pr.number as number;
  } else {
    throw new ValidationError(`Unknown phase: ${phase}`);
  }

  logger.info('wiggum_complete_fix started', {
    phase,
    targetNumber,
    location: phase === 'phase1' ? `issue #${targetNumber}` : `PR #${targetNumber}`,
    iteration: state.wiggum.iteration,
    currentStep: state.wiggum.step,
    fixDescription: input.fix_description,
  });

  // Post PR comment documenting the fix
  const commentTitle = `Fix Applied (Iteration ${state.wiggum.iteration})`;
  const commentBody = `**Fix Description:**

${input.fix_description}

**Next Action:** Restarting workflow monitoring to verify fix.`;

  // Clear the current step and all subsequent steps from completedSteps
  // This ensures we re-verify from the point where issues were found
  const currentStepIndex = STEP_ORDER.indexOf(state.wiggum.step as any);

  logger.info('Filtering completed steps', {
    currentStep: state.wiggum.step,
    currentStepIndex,
    completedStepsBefore: state.wiggum.completedSteps,
  });

  const completedStepsFiltered = state.wiggum.completedSteps.filter((step) => {
    const stepIndex = STEP_ORDER.indexOf(step as any);
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
