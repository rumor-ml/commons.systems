/**
 * Shared utility for building state update failure responses
 *
 * This module provides a standardized error response builder for state update failures
 * across wiggum tools. When a GitHub API call fails to persist workflow state, this
 * function generates a consistent error response with clear instructions for the user.
 *
 * Used by:
 * - wiggum_complete_all_hands (complete-all-hands.ts)
 * - wiggum_complete_fix (complete-fix.ts)
 *
 * @module state-update-error
 */

import { STEP_NAMES } from '../constants.js';
import type { WiggumPhase } from '../constants.js';
import type { CurrentState, WiggumState } from '../state/types.js';
import type { ToolResult } from '../types.js';
import { getTargetNumber } from '../state/state-utils.js';
import { formatWiggumResponse } from './format-response.js';
import { logger } from './logger.js';

/**
 * Parameters for building a state update failure response
 */
export interface StateUpdateFailureParams {
  /** Current workflow state */
  state: CurrentState;
  /** State update result containing the failure reason */
  stateResult: { success: false; reason: string };
  /** New state that was attempted to be persisted */
  newState: WiggumState;
  /** Current workflow phase */
  phase: WiggumPhase;
  /** Steps completed messages to display in the response */
  stepsCompleted: string[];
  /** Name of the calling tool for logging purposes */
  toolName: string;
}

/**
 * Build a standardized error response for state update failures
 *
 * This function creates a consistent error response when a GitHub API call fails
 * to persist the workflow state. The response includes:
 * - Clear error message explaining what happened
 * - Information that the workflow state was NOT modified
 * - Common causes and troubleshooting steps
 * - Instructions to retry after resolving the issue
 *
 * @param params - Parameters for building the error response
 * @returns ToolResult with error flag set and formatted error message
 */
export function buildStateUpdateFailureResponse(params: StateUpdateFailureParams): ToolResult {
  const { state, stateResult, newState, phase, stepsCompleted, toolName } = params;

  logger.error('Critical: State update failed - halting workflow', {
    targetNumber: getTargetNumber(state, phase, toolName),
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

**IMPORTANT: Your workflow state has NOT been modified.**
You are still on: ${STEP_NAMES[state.wiggum.step]}

The race condition fix requires state persistence to GitHub.

Common causes:
- GitHub API rate limiting: Check \`gh api rate_limit\`
- Network connectivity issues

To resolve:
1. Check rate limits: \`gh api rate_limit\`
2. Verify network connectivity
3. Retry by calling ${toolName} again with the same parameters`,
          steps_completed_by_tool: stepsCompleted,
          context: {
            pr_number: phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
            issue_number: phase === 'phase1' && state.issue.exists ? state.issue.number : undefined,
          },
        }),
      },
    ],
    isError: true,
  };
}
