/**
 * Tool: wiggum_init
 *
 * Entry point for the wiggum workflow. Analyzes current state and returns next action.
 *
 * USAGE: Call this tool ONCE at the start of each wiggum invocation. After init returns,
 * follow the instructions provided - completion tools (wiggum_complete_*) will return
 * next step instructions directly. Only call wiggum_init again when:
 * - Starting a new wiggum session
 * - Resuming after a workflow halt (e.g., iteration limit reached)
 * - Restarting after an error recovery
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { getNextStepInstructions } from '../state/router.js';
import { logger } from '../utils/logger.js';
import { generateIterationLimitInstructions, STEP_MAX } from '../constants.js';
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
 * See module-level docs for usage guidelines on when to call this tool.
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
      step_number: STEP_MAX,
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
