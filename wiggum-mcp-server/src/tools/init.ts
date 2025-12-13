/**
 * Tool: wiggum_init
 *
 * Initialization/entry point tool. Analyzes current state and determines next action.
 * This tool should only be called ONCE at the start of the workflow.
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { getNextStepInstructions } from '../state/router.js';
import { logger } from '../utils/logger.js';
import { MAX_ITERATIONS } from '../constants.js';
import type { ToolResult } from '../types.js';
import { formatWiggumResponse } from '../utils/format-response.js';

export const WiggumInitInputSchema = z.object({});

export type WiggumInitInput = z.infer<typeof WiggumInitInputSchema>;

/**
 * Initialize wiggum flow and determine the next step based on current state
 *
 * IMPORTANT: This tool should only be called ONCE at the start of the workflow.
 * After initialization, completion tools will provide next step instructions directly.
 */
export async function wiggumInit(_input: WiggumInitInput): Promise<ToolResult> {
  const state = await detectCurrentState();

  logger.info('wiggum_init', {
    branch: state.git.currentBranch,
    prNumber: state.pr.exists ? state.pr.number : undefined,
    iteration: state.wiggum.iteration,
  });

  // Check iteration limit
  if (state.wiggum.iteration >= MAX_ITERATIONS) {
    logger.warn('wiggum_init - max iterations reached', {
      iteration: state.wiggum.iteration,
      maxIterations: MAX_ITERATIONS,
    });
    const output = {
      current_step: 'Iteration Limit Reached',
      step_number: 'max',
      iteration_count: state.wiggum.iteration,
      instructions: `Maximum iteration limit (${MAX_ITERATIONS}) reached.

Please:
1. Summarize all work completed in this PR
2. List any remaining issues or failures
3. Notify the user that manual intervention is required

The workflow will not continue automatically beyond this point.`,
      steps_completed_by_tool: [],
      context: {
        pr_number: state.pr.exists ? state.pr.number : undefined,
        current_branch: state.git.currentBranch,
      },
    };
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }

  // Use router to determine next step
  return await getNextStepInstructions(state);
}
