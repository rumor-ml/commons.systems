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

import { z } from 'zod';
import { STEP_NAMES } from '../constants.js';
import type { WiggumPhase } from '../constants.js';
import type { CurrentState, WiggumState } from '../state/types.js';
import type { ToolResult } from '../types.js';
import { getTargetNumber } from '../state/state-utils.js';
import { formatWiggumResponse } from './format-response.js';
import { logger } from './logger.js';

/**
 * Parameters for building a state update failure response
 *
 * All fields are readonly to enforce immutability once created.
 * Use createStateUpdateFailureParams() factory function to construct
 * instances with runtime validation of all invariants.
 */
export interface StateUpdateFailureParams {
  /** Current workflow state */
  readonly state: CurrentState;
  /** State update result containing the failure reason */
  readonly stateResult: { readonly success: false; readonly reason: string };
  /** New state that was attempted to be persisted */
  readonly newState: WiggumState;
  /** Current workflow phase */
  readonly phase: WiggumPhase;
  /** Steps completed messages to display in the response */
  readonly stepsCompleted: readonly string[];
  /** Name of the calling tool for logging purposes */
  readonly toolName: string;
}

/**
 * Zod schema for StateUpdateFailureParams validation
 *
 * Validates:
 * - stateResult.success must be false (failure discriminant)
 * - stateResult.reason must be non-empty (useful error message)
 * - toolName must be non-empty (required for retry instructions)
 * - phase must be valid WiggumPhase
 *
 * Note: stepsCompleted can be empty (some failures happen before any steps complete)
 * Note: state and newState are not deeply validated here - they use their own schemas
 */
const StateUpdateFailureParamsSchema = z.object({
  state: z.object({}).passthrough(), // CurrentState validated by its own schema
  stateResult: z.object({
    success: z.literal(false, {
      errorMap: () => ({
        message: 'stateResult.success must be false (this type is for failure responses only)',
      }),
    }),
    reason: z
      .string()
      .min(1, 'stateResult.reason cannot be empty - provide a meaningful failure reason'),
  }),
  newState: z.object({}).passthrough(), // WiggumState validated by its own schema
  phase: z.enum(['phase1', 'phase2']),
  stepsCompleted: z.array(z.string()),
  toolName: z.string().min(1, 'toolName cannot be empty - required for retry instructions'),
});

/**
 * Create a validated StateUpdateFailureParams object
 *
 * Factory function that ensures all StateUpdateFailureParams objects pass runtime
 * validation, catching invalid data early and enforcing all invariants
 * (non-empty reason, non-empty toolName, valid phase, etc.).
 *
 * This follows the same pattern as createWiggumState, createPRExists, etc.
 * for consistency across the codebase.
 *
 * Use this factory instead of direct object construction to guarantee validation:
 * - GOOD: createStateUpdateFailureParams({ state, stateResult: { success: false, reason: 'rate limit' }, ... })
 * - AVOID: const params: StateUpdateFailureParams = { ... }
 *
 * @param params - Parameters to validate
 * @returns Validated StateUpdateFailureParams with all invariants verified
 * @throws {z.ZodError} If validation fails (empty reason, empty toolName, invalid phase, etc.)
 *
 * @example
 * const params = createStateUpdateFailureParams({
 *   state: currentState,
 *   stateResult: { success: false, reason: 'GitHub API rate limit exceeded' },
 *   newState: createWiggumState({ ... }),
 *   phase: 'phase2',
 *   stepsCompleted: ['Validated input', 'Read manifests'],
 *   toolName: 'wiggum_complete_all_hands',
 * });
 */
export function createStateUpdateFailureParams(params: {
  readonly state: CurrentState;
  readonly stateResult: { readonly success: false; readonly reason: string };
  readonly newState: WiggumState;
  readonly phase: WiggumPhase;
  readonly stepsCompleted: readonly string[];
  readonly toolName: string;
}): StateUpdateFailureParams {
  // Validate the params using Zod schema
  // Note: state and newState are not deeply validated here - they use their own schemas
  StateUpdateFailureParamsSchema.parse(params);
  // Return the original params (which are already properly typed) after validation
  return params;
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
