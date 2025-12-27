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
import { generateIterationLimitInstructions } from '../constants.js';
import type { ToolResult } from '../types.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import {
  StateDetectionError,
  StateApiError,
  McpError,
  createErrorResult,
} from '../utils/errors.js';
import { isIterationLimitReached, getEffectiveMaxIterations } from '../state/state-utils.js';

export const WiggumInitInputSchema = z.object({});

export type WiggumInitInput = z.infer<typeof WiggumInitInputSchema>;

/**
 * Initialize wiggum flow and determine the next step based on current state
 *
 * IMPORTANT: This tool should only be called ONCE at the start of the workflow.
 * After initialization, completion tools will provide next step instructions directly.
 */
export async function wiggumInit(_input: WiggumInitInput): Promise<ToolResult> {
  let state;
  try {
    state = await detectCurrentState();
  } catch (error) {
    if (error instanceof StateDetectionError) {
      logger.error('wiggum_init: state detection failed - race condition or rapid state changes', {
        errorType: error.constructor.name,
        errorMessage: error.message,
        context: error.context,
      });
      return createErrorResult(error);
    }
    if (error instanceof StateApiError) {
      logger.error('wiggum_init: GitHub API error during state detection', {
        errorType: error.constructor.name,
        errorMessage: error.message,
        operation: error.operation,
        resourceType: error.resourceType,
        resourceId: error.resourceId,
      });
      return createErrorResult(error);
    }
    // Handle unexpected errors gracefully
    logger.error('wiggum_init: unexpected error during state detection', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Return error result instead of throwing
    const unexpectedError =
      error instanceof Error ? error : new McpError(String(error), 'UNEXPECTED_ERROR');
    return createErrorResult(unexpectedError);
  }

  logger.info('wiggum_init', {
    branch: state.git.currentBranch,
    prNumber: state.pr.exists ? state.pr.number : undefined,
    iteration: state.wiggum.iteration,
  });

  // Check iteration limit
  if (isIterationLimitReached(state.wiggum)) {
    const effectiveLimit = getEffectiveMaxIterations(state.wiggum);
    logger.warn('wiggum_init - max iterations reached', {
      iteration: state.wiggum.iteration,
      maxIterations: effectiveLimit,
      isCustomLimit: state.wiggum.maxIterations !== undefined,
    });
    const output = {
      current_step: 'Iteration Limit Reached',
      step_number: 'max',
      iteration_count: state.wiggum.iteration,
      instructions: generateIterationLimitInstructions(state.wiggum, effectiveLimit),
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
