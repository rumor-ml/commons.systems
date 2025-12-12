/**
 * Tool: wiggum_init
 *
 * Initialization/entry point tool. Analyzes current state and determines next action.
 * This tool should only be called ONCE at the start of the workflow.
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { getNextStepInstructions } from '../state/router.js';
import { MAX_ITERATIONS } from '../constants.js';
import type { ToolResult } from '../types.js';

export const WiggumInitInputSchema = z.object({});

export type WiggumInitInput = z.infer<typeof WiggumInitInputSchema>;

interface WiggumInitOutput {
  current_step: string;
  step_number: string;
  iteration_count: number;
  instructions: string;
  pr_title?: string;
  pr_labels?: string[];
  closing_issue?: string;
  context: {
    pr_number?: number;
    current_branch?: string;
  };
}

/**
 * Initialize wiggum flow and determine the next step based on current state
 *
 * IMPORTANT: This tool should only be called ONCE at the start of the workflow.
 * After initialization, completion tools will provide next step instructions directly.
 */
export async function wiggumInit(_input: WiggumInitInput): Promise<ToolResult> {
  const state = await detectCurrentState();

  // Check iteration limit
  if (state.wiggum.iteration >= MAX_ITERATIONS) {
    const output: WiggumInitOutput = {
      current_step: 'Iteration Limit Reached',
      step_number: 'max',
      iteration_count: state.wiggum.iteration,
      instructions: `Maximum iteration limit (${MAX_ITERATIONS}) reached.

Please:
1. Summarize all work completed in this PR
2. List any remaining issues or failures
3. Notify the user that manual intervention is required

The workflow will not continue automatically beyond this point.`,
      context: {
        pr_number: state.pr.exists ? state.pr.number : undefined,
        current_branch: state.git.currentBranch,
      },
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  // Use router to determine next step
  return await getNextStepInstructions(state);
}
