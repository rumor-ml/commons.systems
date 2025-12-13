/**
 * Tool: wiggum_complete_fix
 *
 * Called after completing a Plan+Fix cycle
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { postWiggumStateComment } from '../state/comments.js';
import { getNextStepInstructions } from '../state/router.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
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
    throw new ValidationError('fix_description is required and cannot be empty');
  }

  const state = await detectCurrentState();

  if (!state.pr.exists || !state.pr.number) {
    throw new ValidationError('No PR found. Cannot complete fix.');
  }

  logger.info('wiggum_complete_fix', {
    prNumber: state.pr.number,
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
  const currentStepIndex = ['0', '1', '1b', '2', '3', '4', '4b', 'approval'].indexOf(
    state.wiggum.step
  );

  const completedStepsFiltered = state.wiggum.completedSteps.filter((step) => {
    const stepIndex = ['0', '1', '1b', '2', '3', '4', '4b', 'approval'].indexOf(step);
    return stepIndex < currentStepIndex;
  });

  // State remains at same step but with filtered completedSteps
  const newState = {
    iteration: state.wiggum.iteration,
    step: state.wiggum.step,
    completedSteps: completedStepsFiltered,
  };

  // Post comment
  await postWiggumStateComment(state.pr.number, newState, commentTitle, commentBody);

  // Get updated state and return next step instructions
  // The router will re-verify from the current step since we cleared completedSteps
  const updatedState = await detectCurrentState();
  return await getNextStepInstructions(updatedState);
}
