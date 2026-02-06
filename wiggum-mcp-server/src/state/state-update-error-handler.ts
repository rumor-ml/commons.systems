/**
 * State update error handler for router.ts
 *
 * Centralizes the error handling pattern for state update failures that was duplicated
 * across 5 locations in router.ts (lines 802, 869, 1166, 1369, 1505). Each occurrence
 * was ~40 lines of identical code for logging errors, building error context, and
 * formatting user-facing error messages.
 *
 * This module provides a single function that:
 * - Logs critical error details for debugging
 * - Builds detailed error context for user-facing messages
 * - Returns standardized ToolResult with isError: true
 *
 * Issue #808: Extracted from router.ts to reduce duplication and file size
 */

import { logger } from '../utils/logger.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { FormattingError } from '../utils/errors.js';
import { STEP_NAMES } from '../constants.js';
import type { WiggumStep } from '../constants.js';
import type { WiggumState } from './types.js';
import type { ToolResult } from '../types.js';
import type { StateUpdateResult } from './router.js';

/**
 * Branded type for positive integers (GitHub issue/PR numbers)
 *
 * Encodes the constraint that issue/PR numbers must be positive integers
 * in the type system, moving validation to the call site where numbers originate.
 */
export type PositiveInteger = number & { readonly __brand: 'PositiveInteger' };

/**
 * Create a PositiveInteger with runtime validation
 *
 * @param n - Number to validate
 * @returns Validated PositiveInteger
 * @throws Error if n is not a positive integer
 */
export function toPositiveInteger(n: number): PositiveInteger {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Must be positive integer, got: ${n}`);
  }
  return n as PositiveInteger;
}

/**
 * Parameters for state update failure handling
 *
 * Provides all necessary context to generate appropriate error messages
 * and log entries for state update failures.
 */
// TODO(#1510): Consider testing readonly type constraints on StateUpdateFailureParams
export interface StateUpdateFailureParams {
  readonly stateResult: StateUpdateResult & { success: false };
  readonly newState: WiggumState;
  readonly step: WiggumStep;
  readonly targetType: 'issue' | 'pr';
  readonly targetNumber: PositiveInteger;
}

/**
 * Guaranteed error result type - handleStateUpdateFailure always returns errors
 *
 * Design note: This function always returns ToolResult with isError: true rather than
 * throwing exceptions because:
 * 1. Callers in router.ts need to return the error result to the MCP framework
 * 2. Maintains consistent error handling pattern across all workflow steps
 * 3. Avoids need for try-catch blocks at 5+ call sites
 */
type GuaranteedError = ToolResult & { isError: true };

/**
 * Create a GuaranteedError with compile-time guarantee
 *
 * Factory function that enforces isError: true at construction time,
 * preventing accidental creation of invalid GuaranteedError objects.
 *
 * @param content - Tool result content
 * @returns GuaranteedError with isError: true
 */
function createGuaranteedError(content: ToolResult['content']): GuaranteedError {
  return {
    content,
    isError: true as const,
  };
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
 * @returns GuaranteedError with formatted error message
 */
// TODO(#1665): Consider adding performance test for error handler execution time
export function handleStateUpdateFailure(params: StateUpdateFailureParams): GuaranteedError {
  const { stateResult, newState, step, targetType, targetNumber } = params;

  // Validate stateResult is actually a failure
  if (stateResult.success !== false) {
    throw new Error(
      'Cannot handle successful state update - this function should only be called for failures'
    );
  }

  // Note: targetNumber validation is enforced by PositiveInteger branded type at call site

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
  // TODO(#1854): Remove outdated TODO - logger.error test already exists

  // Build detailed error context for user-facing message
  const errorDetails = stateResult.lastError
    ? `\n\nActual error: ${stateResult.lastError.message}`
    : '';
  // Show retry count only when attempts were made
  const retryInfo =
    stateResult.attemptCount > 0 ? `\n\nRetry attempts made: ${stateResult.attemptCount}` : '';

  // Format error message with step-specific context
  const targetRef = targetType === 'issue' ? `issue #${targetNumber}` : `PR #${targetNumber}`;
  const verifyCommand =
    targetType === 'issue' ? `gh issue view ${targetNumber}` : `gh pr view ${targetNumber}`;

  // Phase 1 uses empty context (no PR exists yet), Phase 2 includes pr_number
  const context = newState.phase === 'phase1' ? {} : { pr_number: targetNumber };

  // NOTE: formatWiggumResponse can throw FormattingError if constructed data is invalid.
  // This indicates a programming error in this function's data construction, not a user error.
  // The original state update failure is already logged above, so propagation is acceptable.
  try {
    return createGuaranteedError([
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
    ]);
  } catch (error) {
    // Only catch FormattingError (expected, we provide fallback). Other errors are unexpected bugs.
    if (!(error instanceof FormattingError)) {
      // Log unexpected error and re-throw to fail fast
      logger.error('CRITICAL: Unexpected error in handleStateUpdateFailure', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        step,
        targetType,
        targetNumber,
      });
      throw error;
    }

    // Formatting failed (indicates bug in data construction) - log and provide fallback
    logger.error('CRITICAL: Failed to format state update error message', {
      formattingError: error.message,
      step,
      targetType,
      targetNumber,
      impact: 'Error message formatting failed - providing fallback message',
    });

    return createGuaranteedError([
      {
        type: 'text',
        text: `ERROR: State update failed in ${targetRef} (${STEP_NAMES[step]}, iteration ${newState.iteration})

Failure reason: ${stateResult.reason}${errorDetails}${retryInfo}

This is typically caused by:
- GitHub API rate limiting (429)
- Network connectivity issues
- Temporary GitHub API unavailability

Please retry after:
1. Checking rate limits: \`gh api rate_limit\`
2. Verifying network connectivity
3. Confirming ${targetRef} exists: \`${verifyCommand}\`

The workflow will resume from this step once the issue is resolved.

(Note: Error message formatting failed - this is a fallback message. Please report this as a bug.)`,
      },
    ]);
  }
}
