/**
 * State update error handler for router.ts
 *
 * This module extracts repetitive error handling logic from router.ts to reduce duplication
 * and improve maintainability. It provides a standardized way to handle state update failures
 * across different workflow steps.
 *
 * Issue #808: Extracted from router.ts to reduce duplication and file size
 */

import { logger } from '../utils/logger.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { STEP_NAMES } from '../constants.js';
import type { WiggumStep } from '../constants.js';
import type { WiggumState } from './types.js';
import type { ToolResult } from '../types.js';
import type { StateUpdateResult } from './router.js';

/**
 * Parameters for state update failure handling
 *
 * Provides all necessary context to generate appropriate error messages
 * and log entries for state update failures.
 */
// TODO(#1510): Consider testing readonly type constraints on StateUpdateFailureParams
export interface StateUpdateFailureParams {
  readonly stateResult: StateUpdateResult & { readonly success: false };
  readonly newState: WiggumState;
  readonly step: WiggumStep;
  readonly targetType: 'issue' | 'pr';
  readonly targetNumber: number;
}

/**
 * Handle state update failures with standardized logging and error messages
 *
 * This function centralizes the error handling logic for state update failures
 * across all workflow steps. It:
 * - Logs critical error details for debugging
 * - Builds detailed error context for user-facing messages
 * - Returns standardized ToolResult with isError: true
 *
 * @param params - State update failure parameters
 * @returns ToolResult with formatted error message and isError: true
 */
export function handleStateUpdateFailure(params: StateUpdateFailureParams): ToolResult {
  const { stateResult, newState, step, targetType, targetNumber } = params;

  // Validate targetNumber is a positive integer
  if (!Number.isInteger(targetNumber) || targetNumber < 1) {
    throw new Error(`targetNumber must be positive integer, got: ${targetNumber}`);
  }

  // Use actual phase from state instead of deriving from step identifier
  const phase = newState.phase;

  // Log critical error with full context for debugging
  const logContext = {
    ...(targetType === 'issue' ? { issueNumber: targetNumber } : { prNumber: targetNumber }),
    step,
    iteration: newState.iteration,
    phase: newState.phase,
    reason: stateResult.reason,
    lastError: stateResult.lastError?.message,
    attemptCount: stateResult.attemptCount,
    impact: 'Race condition fix requires state persistence',
    recommendation: 'Retry after resolving rate limit/network issues',
  };

  logger.error('Critical: State update failed - halting workflow', logContext);

  // Build detailed error context for user-facing message
  const errorDetails = stateResult.lastError
    ? `\n\nActual error: ${stateResult.lastError.message}`
    : '';
  // Show retry info only if retries were actually attempted (count > 0)
  const retryInfo =
    stateResult.attemptCount > 0 ? `\n\nRetry attempts made: ${stateResult.attemptCount}` : '';

  // Format error message with step-specific context
  const targetRef = targetType === 'issue' ? `issue #${targetNumber}` : `PR #${targetNumber}`;
  const verifyCommand =
    targetType === 'issue' ? `gh issue view ${targetNumber}` : `gh pr view ${targetNumber}`;

  // Build context object for formatWiggumResponse
  // Phase 1: No PR exists yet, so context is empty
  // Phase 2: Include pr_number for PR-related operations
  const context = phase === 'phase1' ? {} : { pr_number: targetNumber };

  // NOTE: formatWiggumResponse can throw FormattingError if data is invalid.
  // This is acceptable because it indicates a programming error in this function's data construction,
  // not a user error. The original error is already logged above (line 68).
  // If formatting fails, the error will propagate and be handled by the caller.
  return {
    content: [
      {
        type: 'text',
        text: formatWiggumResponse({
          current_step: STEP_NAMES[step],
          step_number: step,
          iteration_count: newState.iteration,
          instructions: `ERROR: Failed to update state in ${targetRef} body. The race condition fix requires state persistence.\n\nFailure reason: ${stateResult.reason}${errorDetails}${retryInfo}\n\nThis is typically caused by:\n- GitHub API rate limiting (429)\n- Network connectivity issues\n- Temporary GitHub API unavailability\n\nPlease retry after:\n1. Checking rate limits: \`gh api rate_limit\`\n2. Verifying network connectivity\n3. Confirming ${targetRef} exists: \`${verifyCommand}\`\n\nThe workflow will resume from this step once the issue is resolved.`,
          steps_completed_by_tool: [
            'Attempted to update state in body',
            `Failed due to ${stateResult.reason} after ${stateResult.attemptCount ?? 'unknown'} attempts`,
          ],
          context,
        }),
      },
    ],
    isError: true,
  };
}
