/**
 * Tool: wiggum_complete_fix
 *
 * Called after completing a Plan+Fix cycle
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { postWiggumStateComment } from '../state/comments.js';
import { ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';

export const CompleteFixInputSchema = z.object({
  fix_description: z.string().describe('Brief description of what was fixed'),
  repo: z
    .string()
    .optional()
    .describe('Repository in format "owner/repo" (defaults to current repository)'),
});

export type CompleteFixInput = z.infer<typeof CompleteFixInputSchema>;

interface CompleteFixOutput {
  current_step: string;
  step_number: string;
  iteration_count: number;
  instructions: string;
  context: {
    pr_number?: number;
  };
}

/**
 * Complete a fix cycle and update state
 */
export async function completeFix(input: CompleteFixInput): Promise<ToolResult> {
  if (!input.fix_description || input.fix_description.trim().length === 0) {
    throw new ValidationError('fix_description is required and cannot be empty');
  }

  const state = await detectCurrentState(input.repo);

  if (!state.pr.exists || !state.pr.number) {
    throw new ValidationError('No PR found. Cannot complete fix.');
  }

  // Post PR comment documenting the fix
  const commentTitle = `Fix Applied (Iteration ${state.wiggum.iteration})`;
  const commentBody = `**Fix Description:**

${input.fix_description}

**Next Action:** Restarting workflow monitoring to verify fix.`;

  // State remains at same step but with updated iteration
  const newState = {
    iteration: state.wiggum.iteration,
    step: state.wiggum.step,
    completedSteps: state.wiggum.completedSteps,
  };

  // Post comment
  await postWiggumStateComment(state.pr.number, newState, commentTitle, commentBody, input.repo);

  // Return to Step 1 (workflow monitoring)
  const output: CompleteFixOutput = {
    current_step: 'Fix Complete - Restarting Workflow Monitoring',
    step_number: state.wiggum.step,
    iteration_count: state.wiggum.iteration,
    instructions:
      'Fix applied and committed. Call wiggum_next_step to restart workflow monitoring (Step 1).',
    context: {
      pr_number: state.pr.number,
    },
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}
