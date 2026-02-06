/**
 * Router: Determines next step instructions based on current state
 *
 * This module contains the routing logic that determines what action
 * should be taken next in the wiggum workflow. It's used by both
 * wiggum_init (at start) and completion tools (after each step).
 */

// TODO(#942): Extract verbose error handling pattern in router.ts state update failures
// TODO(#941): Extract duplicate state update pattern in router.ts (safeUpdatePRBodyState and safeUpdateIssueBodyState)
// TODO(#932): Add retry history tracking to StateUpdateResult for better diagnostics
// TODO(#858): Improve state update retry loop error context capture
// TODO(#811): Extract verbose state update error message formatting
// TODO(#810): Extract duplicate safeUpdate functions in router.ts
// TODO(#716): Migrate error classification in router.ts to structured error types
// TODO(#710): Extract type alias for TransientFailureReason
import { getPRReviewComments, sleep } from '../utils/gh-cli.js';
import { updatePRBodyState, updateIssueBodyState } from './body-state.js';
import { monitorRun, monitorPRChecks } from '../utils/gh-workflow.js';
import { logger } from '../utils/logger.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { handleStateUpdateFailure, toPositiveInteger } from './state-update-error-handler.js';
import type { WiggumState, CurrentState, PRExists } from './types.js';
import { WiggumStateSchema, createWiggumState } from './types.js';
import { applyWiggumState } from './state-utils.js';
import { advanceToNextStep } from './transitions.js';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE1_CREATE_PR,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_CHECKS,
  STEP_PHASE2_CODE_QUALITY,
  STEP_PHASE2_SECURITY_REVIEW,
  STEP_PHASE2_APPROVAL,
  STEP_NAMES,
  CODE_QUALITY_BOT_USERNAME,
  SECURITY_REVIEW_COMMAND,
  NEEDS_REVIEW_LABEL,
  WORKFLOW_MONITOR_TIMEOUT_MS,
  generateWorkflowTriageInstructions,
} from '../constants.js';
import type { ToolResult } from '../types.js';
import {
  GitHubCliError,
  StateApiError,
  ValidationError,
  extractZodValidationDetails,
} from '../utils/errors.js';
import { classifyGitHubError } from '@commons/mcp-common/errors';
import { sanitizeErrorMessage } from '../utils/security.js';

/**
 * Helper type for state where PR is guaranteed to exist
 * Used in handlers after Step 0
 */
type CurrentStateWithPR = CurrentState & {
  pr: PRExists;
};

/**
 * Result type for state update operations
 *
 * Discriminated union for race-safe state persistence (issue #388).
 *
 * - Success: State persisted to PR/issue body
 * - Failure: Transient error (rate limit or network) - safe to retry
 *
 * Critical errors (404, auth) throw immediately and never return failure.
 * All failures returned from this type are transient by definition.
 *
 * Failure cases include lastError and attemptCount for debugging (issue #625).
 */
export type StateUpdateResult =
  | { readonly success: true }
  | {
      readonly success: false;
      readonly reason: 'rate_limit' | 'network';
      readonly lastError: Error;
      readonly attemptCount: number;
    };

/**
 * Create a StateUpdateResult failure with validated parameters
 *
 * Enforces type safety at runtime to prevent invalid failure states that could
 * corrupt retry tracking and debugging (issue #625).
 *
 * @param reason - Failure reason ('rate_limit' or 'network')
 * @param lastError - Error from the final retry attempt
 * @param attemptCount - Number of retry attempts made (must be positive integer)
 * @returns StateUpdateResult failure object
 * @throws Error if attemptCount is not a positive integer or lastError is not an Error
 */
export function createStateUpdateFailure(
  reason: 'rate_limit' | 'network',
  lastError: Error,
  attemptCount: number
): StateUpdateResult {
  if (attemptCount < 1 || !Number.isInteger(attemptCount)) {
    throw new Error(
      `createStateUpdateFailure: attemptCount must be positive integer, got: ${attemptCount}`
    );
  }
  if (!(lastError instanceof Error)) {
    throw new Error(`createStateUpdateFailure: lastError must be Error instance`);
  }
  return { success: false, reason, lastError, attemptCount };
}

interface WiggumInstructions {
  current_step: string;
  step_number: string;
  iteration_count: number;
  instructions: string;
  steps_completed_by_tool: string[];
  pr_title?: string;
  pr_labels?: string[];
  closing_issue?: string;
  warning?: string; // Non-fatal warnings to display to user
  context: {
    pr_number?: number;
    current_branch?: string;
  };
}

/**
 * Check for uncommitted changes before workflow monitoring
 *
 * Internal helper shared by handleStepMonitorWorkflow and handleStepMonitorPRChecks.
 * Returns early exit instructions if uncommitted changes detected.
 *
 * @internal Exported via _testExports for unit testing only.
 * @param state - Current workflow state from detectCurrentState
 * @param output - WiggumInstructions object to populate with instructions
 * @param stepsCompleted - Array of steps completed so far to include in output
 * @returns ToolResult with commit instructions if changes found, null otherwise
 */
function checkUncommittedChanges(
  state: CurrentState,
  output: WiggumInstructions,
  stepsCompleted: string[]
): ToolResult | null {
  if (state.git.hasUncommittedChanges) {
    // TODO(#981): Add INFO level logging when uncommitted changes detected
    output.instructions =
      'Uncommitted changes detected. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
    output.steps_completed_by_tool = [...stepsCompleted, 'Checked for uncommitted changes'];
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }
  return null;
}

/**
 * Check if branch is pushed to remote before workflow monitoring
 *
 * Internal helper shared by handleStepMonitorWorkflow and handleStepMonitorPRChecks.
 * Returns early exit instructions if branch not pushed to remote.
 *
 * @internal Exported via _testExports for unit testing only.
 * @param state - Current workflow state from detectCurrentState
 * @param output - WiggumInstructions object to populate with instructions
 * @param stepsCompleted - Array of steps completed so far to include in output
 * @returns ToolResult with push instructions if not pushed, null otherwise
 */
function checkBranchPushed(
  state: CurrentState,
  output: WiggumInstructions,
  stepsCompleted: string[]
): ToolResult | null {
  if (!state.git.isPushed) {
    // TODO(#981): Add INFO level logging when returning early with push instructions
    output.instructions =
      'Branch not pushed to remote. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
    output.steps_completed_by_tool = [...stepsCompleted, 'Checked push status'];
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }
  return null;
}

// TODO(#984): Extract common logic between safeUpdatePRBodyState and safeUpdateIssueBodyState
// into a generic safeUpdateBodyState<T> function to reduce ~480 lines of duplication to ~250 lines.

/**
 * Safely update wiggum state in PR body with error handling and retry logic
 *
 * State persistence is CRITICAL for race condition fix (issue #388). Without
 * successful state updates, workflow state may become inconsistent when tools
 * are called out-of-order or GitHub API returns stale data. This function
 * classifies errors to distinguish between transient failures (safe to retry)
 * and critical failures (require immediate intervention).
 *
 * Retry strategy (issue #799):
 * - Transient errors (429, network): Retry with exponential backoff (2s, 4s, 8s)
 * - Critical errors (404, 401/403): Throw immediately - no retry
 * - Unexpected errors: Re-throw - programming errors or unknown failures
 *
 * @param prNumber - PR number to update
 * @param state - New wiggum state to save
 * @param step - Step identifier for logging context
 * @param maxRetries - Maximum retry attempts for transient failures (default: 3)
 * @returns Result indicating success or transient failure with reason
 * @throws Critical errors (404, 401/403) and unexpected errors
 */
export async function safeUpdatePRBodyState(
  prNumber: number,
  state: WiggumState,
  step: string,
  maxRetries = 3
): Promise<StateUpdateResult> {
  // Validate prNumber parameter (must be positive integer for valid PR number)
  // CRITICAL: Invalid prNumber would cause StateApiError.create() to throw ValidationError
  // inside catch blocks (line 255), potentially masking the original error
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new ValidationError(
      `safeUpdatePRBodyState: prNumber must be a positive integer, got: ${prNumber} (type: ${typeof prNumber})`
    );
  }

  // Validate maxRetries to ensure retry loop executes correctly (issue #625)
  // CRITICAL: Invalid maxRetries would break retry logic:
  //   - maxRetries < 1: Loop would not execute (no retries attempted)
  //   - maxRetries > 100: Excessive delays due to uncapped exponential backoff (attempt 10 = ~17 min)
  //   - Non-integer (0.5, NaN, Infinity): Unpredictable loop behavior
  const MAX_RETRIES_LIMIT = 100;
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > MAX_RETRIES_LIMIT) {
    logger.error('safeUpdatePRBodyState: Invalid maxRetries parameter', {
      prNumber,
      step,
      maxRetries,
      maxRetriesType: typeof maxRetries,
      phase: state.phase,
      impact: 'Cannot execute retry loop with invalid parameter',
    });
    throw new Error(
      `safeUpdatePRBodyState: maxRetries must be a positive integer between 1 and ${MAX_RETRIES_LIMIT}, ` +
        `got: ${maxRetries} (type: ${typeof maxRetries}). ` +
        `Common values: 3 (default), 5 (flaky operations), 10 (very flaky). ` +
        `Values > 10 may indicate excessive retry tolerance that masks systemic issues.`
    );
  }

  // Validate state before attempting to post (issue #799: state validation errors)
  // This catches invalid states early and provides clear error messages rather than
  // opaque GitHub API errors when posting malformed state to PR body
  try {
    WiggumStateSchema.parse(state);
  } catch (validationError) {
    const { details, originalError } = extractZodValidationDetails(validationError, {
      prNumber,
      step,
    });

    logger.error('safeUpdatePRBodyState: State validation failed before posting', {
      prNumber,
      step,
      state,
      validationDetails: details,
      error: originalError?.message ?? String(validationError),
      errorStack: originalError?.stack,
      impact: 'Invalid state cannot be persisted to GitHub',
    });
    // Include state summary in error message for debugging without log access (issue #625)
    const stateSummary = `phase=${state.phase}, step=${state.step}, iteration=${state.iteration}, completedSteps=[${state.completedSteps.join(',')}]`;
    throw StateApiError.create(
      `Invalid state - validation failed: ${details}. State: ${stateSummary}`,
      'write',
      'pr',
      prNumber,
      originalError ?? new Error(String(validationError))
    );
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await updatePRBodyState(prNumber, state);

      // Log recovery on retry success
      if (attempt > 1) {
        logger.info('State update succeeded after retry', {
          prNumber,
          step,
          attempt,
          maxRetries,
          impact: 'Transient failure recovered automatically',
        });
      }

      return { success: true };
    } catch (updateError) {
      // State update is CRITICAL for race condition fix (issue #388)
      // Classify errors to distinguish transient (rate limit, network) from critical (404, auth)
      //
      // Known limitations:
      // TODO(#320): Surface state persistence failures to users instead of silent warning (user-facing)
      // TODO(#415): Add type guards to catch blocks to avoid broad exception catching (type safety)
      // TODO(#468): Broad catch-all hides programming errors - add early type validation (related to #415)
      const errorMsg = updateError instanceof Error ? updateError.message : String(updateError);
      const exitCode = updateError instanceof GitHubCliError ? updateError.exitCode : undefined;
      const stderr = updateError instanceof GitHubCliError ? updateError.stderr : undefined;
      const stateJson = JSON.stringify(state);

      // Classify error type using shared utility
      // TODO(#478): Document expected GitHub API error patterns and add test coverage
      const classification = classifyGitHubError(updateError, exitCode);

      // Build error context including classification results for debugging
      const errorContext = {
        prNumber,
        step,
        attempt,
        maxRetries,
        iteration: state.iteration,
        phase: state.phase,
        completedSteps: state.completedSteps,
        stateJson,
        error: errorMsg,
        errorType: updateError instanceof GitHubCliError ? 'GitHubCliError' : typeof updateError,
        exitCode,
        stderr,
        classification,
      };

      // Critical errors: PR not found or authentication failures - throw immediately (no retry)
      if (classification.is404) {
        logger.error('Critical: PR not found - cannot update state in body', {
          ...errorContext,
          impact: 'Workflow state persistence failed',
          recommendation: `Verify PR #${prNumber} exists: gh pr view ${prNumber}`,
          nextSteps: 'Workflow cannot continue without valid PR',
          isTransient: false,
        });
        throw updateError;
      }

      if (classification.isAuth) {
        logger.error('Critical: Authentication failed - cannot update state in body', {
          ...errorContext,
          impact: 'Workflow state persistence failed - insufficient permissions',
          recommendation: 'Check gh auth status and token scopes: gh auth status',
          nextSteps: 'Re-authenticate or update token permissions',
          isTransient: false,
        });
        throw updateError;
      }

      // Transient errors: Rate limits or network issues - retry with backoff
      if (classification.isTransient) {
        const reason = classification.isRateLimit ? 'rate_limit' : 'network';

        if (attempt < maxRetries) {
          // Exponential backoff: 2^attempt seconds, capped at 60s
          const MAX_DELAY_MS = 60000;
          const uncappedDelayMs = Math.pow(2, attempt) * 1000;
          const delayMs = Math.min(uncappedDelayMs, MAX_DELAY_MS);
          logger.info('Transient error updating state - retrying with backoff', {
            ...errorContext,
            reason,
            delayMs,
            wasCapped: uncappedDelayMs > MAX_DELAY_MS,
            remainingAttempts: maxRetries - attempt,
          });
          await sleep(delayMs);
          continue; // Retry
        }

        // All retries exhausted - return failure result with error context for debugging
        const lastErrorObj =
          updateError instanceof Error ? updateError : new Error(String(updateError));
        logger.warn('State update failed after all retries', {
          ...errorContext,
          reason,
          impact: 'Workflow halted - manual retry required',
          recommendation:
            reason === 'rate_limit'
              ? 'Check rate limit status: gh api rate_limit'
              : 'Check network connection and GitHub API status',
          isTransient: true,
        });
        return createStateUpdateFailure(reason, lastErrorObj, maxRetries);
      }

      // Unexpected errors: Programming errors or unknown failures - throw immediately
      logger.error('Unexpected error updating state in PR body - re-throwing', {
        ...errorContext,
        impact: 'Unknown failure type - may indicate programming error',
        recommendation: 'Review error message and stack trace',
        nextSteps: 'Workflow halted - manual investigation required',
        isTransient: false,
      });
      throw updateError;
    }
  }
  // Fallback: TypeScript cannot prove all catch paths return/throw.
  // If this executes, investigate gap in error classification (issue #625).
  logger.error('INTERNAL: safeUpdatePRBodyState retry loop completed without returning', {
    prNumber,
    step,
    maxRetries,
    phase: state.phase,
    iteration: state.iteration,
    stateJson: JSON.stringify(state),
    impact: 'Programming error in retry logic',
  });
  throw new Error(
    `INTERNAL ERROR: safeUpdatePRBodyState retry loop completed without returning. ` +
      `PR: #${prNumber}, Step: ${step}, maxRetries: ${maxRetries}, ` +
      `Phase: ${state.phase}, Iteration: ${state.iteration}`
  );
}

/**
 * Safely update wiggum state in issue body with error handling and retry logic
 *
 * State persistence is CRITICAL for race condition fix (issue #388). Without
 * successful state updates, workflow state may become inconsistent when tools
 * are called out-of-order or GitHub API returns stale data.
 *
 * Retry strategy (issue #799):
 * - Transient errors (429, network): Retry with exponential backoff (2s, 4s, 8s)
 * - Critical errors (404, 401/403): Throw immediately - no retry
 * - Unexpected errors: Re-throw - programming errors or unknown failures
 *
 * @param issueNumber - Issue number to update
 * @param state - New wiggum state to save
 * @param step - Step identifier for logging context
 * @param maxRetries - Maximum retry attempts for transient failures (default: 3)
 * @returns Result indicating success or transient failure with reason
 * @throws Critical errors (404, 401/403) and unexpected errors
 */
export async function safeUpdateIssueBodyState(
  issueNumber: number,
  state: WiggumState,
  step: string,
  maxRetries = 3
): Promise<StateUpdateResult> {
  // Validate issueNumber parameter (must be positive integer for valid issue number)
  // CRITICAL: Invalid issueNumber would cause StateApiError.create() to throw ValidationError
  // inside catch blocks (line 472), potentially masking the original error
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new ValidationError(
      `safeUpdateIssueBodyState: issueNumber must be a positive integer, got: ${issueNumber} (type: ${typeof issueNumber})`
    );
  }

  // Validate maxRetries to ensure retry loop executes correctly (issue #625)
  // CRITICAL: Invalid maxRetries would break retry logic:
  //   - maxRetries < 1: Loop would not execute (no retries attempted)
  //   - maxRetries > 100: Excessive delays due to uncapped exponential backoff (attempt 10 = ~17 min)
  //   - Non-integer (0.5, NaN, Infinity): Unpredictable loop behavior
  const MAX_RETRIES_LIMIT = 100;
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > MAX_RETRIES_LIMIT) {
    logger.error('safeUpdateIssueBodyState: Invalid maxRetries parameter', {
      issueNumber,
      step,
      maxRetries,
      maxRetriesType: typeof maxRetries,
      phase: state.phase,
      impact: 'Cannot execute retry loop with invalid parameter',
    });
    throw new Error(
      `safeUpdateIssueBodyState: maxRetries must be a positive integer between 1 and ${MAX_RETRIES_LIMIT}, ` +
        `got: ${maxRetries} (type: ${typeof maxRetries}). ` +
        `Common values: 3 (default), 5 (flaky operations), 10 (very flaky). ` +
        `Values > 10 may indicate excessive retry tolerance that masks systemic issues.`
    );
  }

  // Validate state before attempting to post (issue #799: state validation errors)
  // This catches invalid states early and provides clear error messages rather than
  // opaque GitHub API errors when posting malformed state to issue body
  try {
    WiggumStateSchema.parse(state);
  } catch (validationError) {
    const { details, originalError } = extractZodValidationDetails(validationError, {
      issueNumber,
      step,
    });

    logger.error('safeUpdateIssueBodyState: State validation failed before posting', {
      issueNumber,
      step,
      state,
      validationDetails: details,
      error: originalError?.message ?? String(validationError),
      errorStack: originalError?.stack,
      impact: 'Invalid state cannot be persisted to GitHub',
    });
    // Include state summary in error message for debugging without log access (issue #625)
    const stateSummary = `phase=${state.phase}, step=${state.step}, iteration=${state.iteration}, completedSteps=[${state.completedSteps.join(',')}]`;
    throw StateApiError.create(
      `Invalid state - validation failed: ${details}. State: ${stateSummary}`,
      'write',
      'issue',
      issueNumber,
      originalError ?? new Error(String(validationError))
    );
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await updateIssueBodyState(issueNumber, state);

      // Log recovery on retry success
      if (attempt > 1) {
        logger.info('State update succeeded after retry', {
          issueNumber,
          step,
          attempt,
          maxRetries,
          impact: 'Transient failure recovered automatically',
        });
      }

      return { success: true };
    } catch (updateError) {
      // TODO(#415): Add type guards to catch blocks to avoid broad exception catching
      const errorMsg = updateError instanceof Error ? updateError.message : String(updateError);
      const exitCode = updateError instanceof GitHubCliError ? updateError.exitCode : undefined;
      const stderr = updateError instanceof GitHubCliError ? updateError.stderr : undefined;
      const stateJson = JSON.stringify(state);

      // Classify error type using shared utility
      // TODO(#478): Document expected GitHub API error patterns and add test coverage
      const classification = classifyGitHubError(updateError, exitCode);

      // Build error context including classification results for debugging
      const errorContext = {
        issueNumber,
        step,
        attempt,
        maxRetries,
        iteration: state.iteration,
        phase: state.phase,
        completedSteps: state.completedSteps,
        stateJson,
        error: errorMsg,
        errorType: updateError instanceof GitHubCliError ? 'GitHubCliError' : typeof updateError,
        exitCode,
        stderr,
        classification,
      };

      // Critical errors: Issue not found or authentication failures - throw immediately (no retry)
      if (classification.is404) {
        logger.error('Critical: Issue not found - cannot update state in body', {
          ...errorContext,
          impact: 'Workflow state persistence failed',
          recommendation: `Verify issue #${issueNumber} exists: gh issue view ${issueNumber}`,
          nextSteps: 'Workflow cannot continue without valid issue',
          isTransient: false,
        });
        throw updateError;
      }

      if (classification.isAuth) {
        logger.error('Critical: Authentication failed - cannot update state in body', {
          ...errorContext,
          impact: 'Workflow state persistence failed - insufficient permissions',
          recommendation: 'Check gh auth status and token scopes: gh auth status',
          nextSteps: 'Re-authenticate or update token permissions',
          isTransient: false,
        });
        throw updateError;
      }

      // Transient errors: Rate limits or network issues - retry with backoff
      if (classification.isTransient) {
        const reason = classification.isRateLimit ? 'rate_limit' : 'network';

        if (attempt < maxRetries) {
          // Exponential backoff: 2^attempt seconds, capped at 60s
          const MAX_DELAY_MS = 60000;
          const uncappedDelayMs = Math.pow(2, attempt) * 1000;
          const delayMs = Math.min(uncappedDelayMs, MAX_DELAY_MS);
          logger.info('Transient error updating state - retrying with backoff', {
            ...errorContext,
            reason,
            delayMs,
            wasCapped: uncappedDelayMs > MAX_DELAY_MS,
            remainingAttempts: maxRetries - attempt,
          });
          await sleep(delayMs);
          continue; // Retry
        }

        // All retries exhausted - return failure result with error context for debugging
        const lastErrorObj =
          updateError instanceof Error ? updateError : new Error(String(updateError));
        logger.warn('State update failed after all retries', {
          ...errorContext,
          reason,
          impact: 'Workflow halted - manual retry required',
          recommendation:
            reason === 'rate_limit'
              ? 'Check rate limit status: gh api rate_limit'
              : 'Check network connection and GitHub API status',
          isTransient: true,
        });
        return createStateUpdateFailure(reason, lastErrorObj, maxRetries);
      }

      // Unexpected errors: Programming errors or unknown failures - throw immediately
      logger.error('Unexpected error updating state in issue body - re-throwing', {
        ...errorContext,
        impact: 'Unknown failure type - may indicate programming error',
        recommendation: 'Review error message and stack trace',
        nextSteps: 'Workflow halted - manual investigation required',
        isTransient: false,
      });
      throw updateError;
    }
  }
  // Fallback: TypeScript cannot prove all catch paths return/throw.
  // If this executes, investigate gap in error classification (issue #625).
  logger.error('INTERNAL: safeUpdateIssueBodyState retry loop completed without returning', {
    issueNumber,
    step,
    maxRetries,
    phase: state.phase,
    iteration: state.iteration,
    stateJson: JSON.stringify(state),
    impact: 'Programming error in retry logic',
  });
  throw new Error(
    `INTERNAL ERROR: safeUpdateIssueBodyState retry loop completed without returning. ` +
      `Issue: #${issueNumber}, Step: ${step}, maxRetries: ${maxRetries}, ` +
      `Phase: ${state.phase}, Iteration: ${state.iteration}`
  );
}

/**
 * Format fix instructions for workflow/check failures
 *
 * Generates standardized fix instructions for any workflow or check failure.
 * If issueNumber is provided, uses triage workflow to separate in-scope from out-of-scope failures.
 * Otherwise, provides direct fix instructions for the complete Plan -> Fix -> Commit -> Complete cycle.
 *
 * SECURITY: failureDetails is sanitized to prevent secret exposure and
 * markdown formatting issues. Input comes from GitHub API (workflow logs,
 * check outputs) via gh_get_failure_details.
 *
 * @param failureType - Type of failure (e.g., "Workflow", "PR checks")
 * @param failureDetails - Detailed error information from gh_get_failure_details (will be sanitized)
 * @param defaultMessage - Fallback message if no failure details available
 * @param issueNumber - Optional issue number to enable triage mode
 * @returns Formatted markdown instructions for fixing the failure with sanitized failure details
 */
// TODO(#334): Add integration test for triage branching logic
function formatFixInstructions(
  failureType: string,
  failureDetails: string | undefined,
  defaultMessage: string,
  issueNumber?: number
): string {
  // Sanitize external input to prevent secret exposure and markdown issues
  // failureDetails comes from GitHub API responses (workflow logs, check outputs)
  let sanitizedDetails: string;
  let truncationIndicator = '';

  if (failureDetails) {
    const originalLength = failureDetails.length;
    const hadMultipleLines = failureDetails.includes('\n');
    sanitizedDetails = sanitizeErrorMessage(failureDetails, 1000);

    // Detect sanitization and log for debugging
    const wasLengthTruncated = sanitizedDetails.length < originalLength;
    const wasMultilineReduced = hadMultipleLines && !sanitizedDetails.includes('\n');
    const wasSanitized = wasLengthTruncated || wasMultilineReduced;

    if (wasSanitized) {
      logger.info('Error details sanitized during formatting', {
        failureType,
        originalLength,
        sanitizedLength: sanitizedDetails.length,
        wasLengthTruncated,
        wasMultilineReduced,
        impact: 'User sees sanitized error message',
        recommendation: 'Check full failure details in GitHub workflow logs',
      });
      // Add user-facing indicator only for significant truncation
      if (wasLengthTruncated) {
        truncationIndicator =
          '\n\n_(Error details truncated. See workflow logs for full details.)_';
      }
    }
  } else {
    sanitizedDetails = defaultMessage;
  }

  // If issueNumber provided, use triage workflow
  if (issueNumber !== undefined) {
    return (
      generateWorkflowTriageInstructions(
        issueNumber,
        failureType as 'Workflow' | 'PR checks',
        sanitizedDetails
      ) + truncationIndicator
    );
  }

  // Fall back to direct fix instructions if no issueNumber
  return `${failureType} failed. Follow these steps to fix:

1. Analyze the error details below (includes test failures, stack traces, file locations)
2. Use Task tool with subagent_type="Plan" and model="opus" to create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description

**Failure Details:**
${sanitizedDetails}${truncationIndicator}`;
}

/**
 * Determines next step instructions based on current state
 *
 * This is the core routing logic that decides what action should be
 * taken next in the workflow. Called by wiggum_init and completion tools.
 */
export async function getNextStepInstructions(state: CurrentState): Promise<ToolResult> {
  logger.debug('getNextStepInstructions', {
    phase: state.wiggum.phase,
    prExists: state.pr.exists,
    prState: state.pr.exists ? state.pr.state : 'N/A',
    currentBranch: state.git.currentBranch,
    iteration: state.wiggum.iteration,
    completedSteps: state.wiggum.completedSteps,
  });

  // Route based on phase
  return state.wiggum.phase === 'phase1'
    ? await getPhase1NextStep(state)
    : await getPhase2NextStep(state);
}

/**
 * Phase 1 routing: Pre-PR workflow
 * State is stored in issue comments
 */
async function getPhase1NextStep(state: CurrentState): Promise<ToolResult> {
  // Validate issue exists
  if (!state.issue.exists || !state.issue.number) {
    return {
      content: [
        {
          type: 'text',
          text: 'ERROR: Cannot run Phase 1 workflow: No issue number found in branch name. Expected format: "123-feature-name"',
        },
      ],
      isError: true,
    };
  }

  const issueNumber = state.issue.number;

  // Step p1-1: Monitor feature branch workflow
  if (!state.wiggum.completedSteps.includes(STEP_PHASE1_MONITOR_WORKFLOW)) {
    return await handlePhase1MonitorWorkflow(state, issueNumber);
  }

  // Step p1-2: PR Review
  if (!state.wiggum.completedSteps.includes(STEP_PHASE1_PR_REVIEW)) {
    return handlePhase1PRReview(state, issueNumber);
  }

  // Step p1-3: Security Review
  if (!state.wiggum.completedSteps.includes(STEP_PHASE1_SECURITY_REVIEW)) {
    return handlePhase1SecurityReview(state, issueNumber);
  }

  // Step p1-4: Create PR (all Phase 1 reviews passed!)
  return handlePhase1CreatePR(state, issueNumber);
}

/**
 * Phase 1 Step 1: Monitor Feature Branch Workflow
 *
 * This handler performs inline monitoring of the feature branch workflow.
 * On success, it marks Step p1-1 complete and proceeds to Step p1-2.
 * On failure, it returns fix instructions with failure details.
 */
// TODO(#334): Add integration test for failure path with triage
async function handlePhase1MonitorWorkflow(
  state: CurrentState,
  issueNumber: number
): Promise<ToolResult> {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_MONITOR_WORKFLOW],
    step_number: STEP_PHASE1_MONITOR_WORKFLOW,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    steps_completed_by_tool: [],
    context: {
      current_branch: state.git.currentBranch,
    },
  };

  // Check for uncommitted changes before monitoring
  const uncommittedCheck = checkUncommittedChanges(state, output, []);
  if (uncommittedCheck) return uncommittedCheck;

  // Check if branch is pushed to remote
  const pushCheck = checkBranchPushed(state, output, []);
  if (pushCheck) return pushCheck;

  // Call monitoring tool directly
  const monitorResult = await monitorRun(state.git.currentBranch, WORKFLOW_MONITOR_TIMEOUT_MS);

  if (monitorResult.success) {
    // Mark Step p1-1 complete and advance to next step
    // Use advanceToNextStep() to maintain state invariant (issue #799)
    const newState: WiggumState = advanceToNextStep(state.wiggum);

    const stateResult = await safeUpdateIssueBodyState(
      issueNumber,
      newState,
      STEP_PHASE1_MONITOR_WORKFLOW
    );

    if (!stateResult.success) {
      return handleStateUpdateFailure({
        stateResult,
        newState,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: toPositiveInteger(issueNumber),
      });
    }

    // Reuse newState to avoid race condition with GitHub API (issue #388)
    // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
    // state changes have occurred (PR closed, commits added, issue modified). This is safe
    // during inline step transitions within the same tool call. For state staleness validation,
    // see issue #391.
    const updatedState = applyWiggumState(state, newState);

    // Continue to Step p1-2 (PR Review)
    return await getNextStepInstructions(updatedState);
  } else {
    // Workflow failed - increment iteration and return fix instructions with triage
    const newState = createWiggumState({
      iteration: state.wiggum.iteration + 1,
      step: STEP_PHASE1_MONITOR_WORKFLOW,
      completedSteps: state.wiggum.completedSteps,
      phase: 'phase1' as const,
    });

    const stateResult = await safeUpdateIssueBodyState(
      issueNumber,
      newState,
      STEP_PHASE1_MONITOR_WORKFLOW
    );

    if (!stateResult.success) {
      return handleStateUpdateFailure({
        stateResult,
        newState,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        targetType: 'issue',
        targetNumber: toPositiveInteger(issueNumber),
      });
    }

    output.iteration_count = newState.iteration;
    // Use triage instructions with issue number for scope filtering
    output.instructions = formatFixInstructions(
      'Workflow',
      monitorResult.failureDetails || monitorResult.errorSummary,
      'See workflow logs for details',
      issueNumber
    );
    output.steps_completed_by_tool = [
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored workflow run until first failure',
      'Retrieved complete failure details via gh_get_failure_details tool',
      'Updated state in issue body',
      'Incremented iteration',
    ];
  }

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 1 Step 2: PR Review
 */
function handlePhase1PRReview(state: CurrentState, _issueNumber: number): ToolResult {
  // Return pure state - orchestration instructions are in wiggum.md

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_PR_REVIEW],
    step_number: STEP_PHASE1_PR_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `Follow wiggum skill instructions for step **${STEP_NAMES[STEP_PHASE1_PR_REVIEW]}**.`,
    steps_completed_by_tool: [],
    context: {},
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 1 Step 3: Security Review
 */
function handlePhase1SecurityReview(state: CurrentState, issueNumber: number): ToolResult {
  // Get active agents (filter out completed ones)
  // All agents run every iteration

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_SECURITY_REVIEW],
    step_number: STEP_PHASE1_SECURITY_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `## Step 3: Security Review (Before PR Creation)

Execute security review on the current branch before creating the pull request.

**Instructions:**

1. Execute the security review command:
   \`\`\`
   ${SECURITY_REVIEW_COMMAND}
   \`\`\`

2. After the review completes, aggregate results from all agents:
   - Collect result file paths from each agent's JSON response
   - Sum issue counts across all agents

3. If any in-scope issues were found and fixed:
   - Execute \`/commit-merge-push\` using SlashCommand tool

4. Call the \`wiggum_complete_security_review\` tool with:
   - command_executed: true
   - in_scope_result_files: [array of result file paths from all agents]
   - out_of_scope_result_files: [array of result file paths from all agents]
   - in_scope_issue_count: (total count of in-scope security issues across all result files)
   - out_of_scope_issue_count: (total count of out-of-scope security issues across all result files)

   **NOTE:** Issue counts represent ISSUES, not FILES. Each result file may contain multiple issues.

5. Results will be posted to issue #${issueNumber}

6. If issues are found:
   - You will be instructed to fix them (Plan + Fix cycle)
   - After fixes, workflow restarts from Step p1-1

7. If no issues:
   - Proceed to Step p1-4 (Create PR - All Pre-PR Reviews Passed!)`,
    steps_completed_by_tool: [],
    context: {},
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 1 Step 4: Create PR
 */
function handlePhase1CreatePR(state: CurrentState, issueNumber: number): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_CREATE_PR],
    step_number: STEP_PHASE1_CREATE_PR,
    iteration_count: state.wiggum.iteration,
    instructions: `## Step 4: Create Pull Request

Phase 1 complete! All reviews passed. Ready to create the pull request.

**Instructions:**

1. Provide a comprehensive PR description covering ALL commits on the branch:
   - Run: \`git log main..HEAD\` to see all commits
   - Summarize what was implemented/fixed

2. Call the \`wiggum_complete_pr_creation\` tool with:
   - pr_description: (comprehensive description of all changes)

3. The tool will:
   - Create the PR
   - Transition to Phase 2
   - Post initial Phase 2 state to the new PR
   - Begin Phase 2 workflow (PR workflow monitoring)

Phase 1 reviews passed - creating PR will begin Phase 2.`,
    steps_completed_by_tool: [],
    closing_issue: `#${issueNumber}`,
    context: {
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 2 routing: Post-PR workflow
 * State is stored in PR comments
 */
async function getPhase2NextStep(state: CurrentState): Promise<ToolResult> {
  // Ensure OPEN PR exists (treat CLOSED/MERGED PRs as non-existent)
  // We need an OPEN PR to proceed with monitoring and reviews
  // TODO(#378): Use hasExistingPR type guard instead of inline check
  if (!state.pr.exists || state.pr.state !== 'OPEN') {
    logger.error('Phase 2 workflow requires an open PR', {
      prExists: state.pr.exists,
      prState: state.pr.exists ? state.pr.state : 'N/A',
    });
    return {
      content: [
        {
          type: 'text',
          text: 'ERROR: Phase 2 workflow requires an open PR. PR does not exist or is not in OPEN state.',
        },
      ],
      isError: true,
    };
  }

  // After this point, PR is guaranteed to exist (type-safe via type guard)
  // TypeScript now knows state is CurrentStateWithPR
  const stateWithPR = state as CurrentStateWithPR;

  // Step p2-1: Monitor Workflow (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_MONITOR_WORKFLOW)) {
    logger.info('Routing to Phase 2 Step 1: Monitor Workflow', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handlePhase2MonitorWorkflow(stateWithPR);
  }

  // Step p2-2: Monitor PR Checks (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_MONITOR_CHECKS)) {
    logger.info('Routing to Phase 2 Step 2: Monitor PR Checks', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handlePhase2MonitorPRChecks(stateWithPR);
  }

  // Step p2-3: Code Quality Comments (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_CODE_QUALITY)) {
    logger.info('Routing to Phase 2 Step 3: Code Quality', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handlePhase2CodeQuality(stateWithPR);
  }

  // Step p2-5: Security Review (if not completed)
  // NOTE: Phase 2 PR review (p2-4) removed - Phase 1 review is comprehensive
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_SECURITY_REVIEW)) {
    logger.info('Routing to Phase 2 Step 5: Security Review', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return handlePhase2SecurityReview(stateWithPR);
  }

  // All steps complete - proceed to approval
  logger.info('Routing to Approval', {
    prNumber: stateWithPR.pr.number,
    iteration: state.wiggum.iteration,
  });
  return handleApproval(stateWithPR);
}

/**
 * Phase 2 Step 1: Monitor Workflow (also completes Step 2 when successful)
 *
 * This handler completes BOTH Step p2-1 (workflow monitoring) AND Step p2-2 (PR checks)
 * in a single function call when successful:
 *
 * 1. Monitors workflow run - marks Step p2-1 complete on success
 * 2. If Step p2-1 passes, continues inline to monitor PR checks
 * 3. If Step p2-2 passes, marks Step p2-2 complete and continues to Step p2-3
 *
 * This combined execution is an optimization to avoid returning to the agent
 * between Step p2-1 and Step p2-2 when both are expected to pass together.
 *
 * When called standalone after fixes (via handlePhase2MonitorPRChecks), only
 * Step p2-2 is executed since Step p2-1 is already in completedSteps.
 */
async function handlePhase2MonitorWorkflow(state: CurrentStateWithPR): Promise<ToolResult> {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_MONITOR_WORKFLOW],
    step_number: STEP_PHASE2_MONITOR_WORKFLOW,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  // Call monitoring tool directly
  const monitorResult = await monitorRun(state.git.currentBranch, WORKFLOW_MONITOR_TIMEOUT_MS);

  if (monitorResult.success) {
    // Mark Step p2-1 complete and advance to next step
    // Use advanceToNextStep() to maintain state invariant (issue #799)
    const newState: WiggumState = advanceToNextStep(state.wiggum);

    const stateResult = await safeUpdatePRBodyState(
      state.pr.number,
      newState,
      STEP_PHASE2_MONITOR_WORKFLOW
    );

    if (!stateResult.success) {
      return handleStateUpdateFailure({
        stateResult,
        newState,
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        targetType: 'pr',
        targetNumber: toPositiveInteger(state.pr.number),
      });
    }

    const stepsCompleted = [
      'Monitored workflow run until completion',
      'Marked Step p2-1 complete',
      'Updated state in PR body',
    ];

    // CONTINUE to Step p2-2: Monitor PR checks (within same function call)
    // Reuse newState to avoid race condition (issue #799: state validation errors)
    const updatedState = applyWiggumState(state, newState);

    const uncommittedCheck = checkUncommittedChanges(updatedState, output, stepsCompleted);
    if (uncommittedCheck) return uncommittedCheck;

    const pushCheck = checkBranchPushed(updatedState, output, stepsCompleted);
    if (pushCheck) return pushCheck;

    // Monitor PR checks
    const prChecksResult = await monitorPRChecks(state.pr.number, WORKFLOW_MONITOR_TIMEOUT_MS);

    if (!prChecksResult.success) {
      // PR checks failed - return fix instructions with triage
      output.instructions = formatFixInstructions(
        'PR checks',
        prChecksResult.failureDetails || prChecksResult.errorSummary,
        'See PR checks for details',
        updatedState.issue.exists ? updatedState.issue.number : undefined
      );
      output.steps_completed_by_tool = [
        ...stepsCompleted,
        'Checked for uncommitted changes',
        'Checked push status',
        'Monitored PR checks until first failure',
        'Retrieved complete failure details via gh_get_failure_details tool',
      ];
      return {
        content: [{ type: 'text', text: formatWiggumResponse(output) }],
      };
    }

    // PR checks succeeded - mark Step p2-2 complete and advance to next step
    // Use advanceToNextStep() to maintain state invariant (issue #799)
    const newState2: WiggumState = advanceToNextStep(updatedState.wiggum);

    const stateResult2 = await safeUpdatePRBodyState(
      state.pr.number,
      newState2,
      STEP_PHASE2_MONITOR_CHECKS
    );

    if (!stateResult2.success) {
      return handleStateUpdateFailure({
        stateResult: stateResult2,
        newState: newState2,
        step: STEP_PHASE2_MONITOR_CHECKS,
        targetType: 'pr',
        targetNumber: toPositiveInteger(state.pr.number),
      });
    }

    stepsCompleted.push(
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored all PR checks until completion',
      'Marked Step p2-2 complete',
      'Updated state in PR body'
    );

    // CONTINUE to Step p2-3: Code Quality
    // Reuse newState2 to avoid race condition (issue #799: state validation errors)
    const finalState = applyWiggumState(updatedState, newState2);
    return processPhase2CodeQualityAndReturnNextInstructions(
      finalState as CurrentStateWithPR,
      stepsCompleted
    );
  } else {
    // Return fix instructions with triage
    output.instructions = formatFixInstructions(
      'Workflow',
      monitorResult.failureDetails || monitorResult.errorSummary,
      'See workflow logs for details',
      state.issue.exists ? state.issue.number : undefined
    );
    output.steps_completed_by_tool = [
      'Monitored workflow run until first failure',
      'Retrieved complete failure details via gh_get_failure_details tool',
    ];
  }

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 2 Step 2: Monitor PR Checks
 */
async function handlePhase2MonitorPRChecks(state: CurrentStateWithPR): Promise<ToolResult> {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_MONITOR_CHECKS],
    step_number: STEP_PHASE2_MONITOR_CHECKS,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  const uncommittedCheck = checkUncommittedChanges(state, output, []);
  if (uncommittedCheck) return uncommittedCheck;

  const pushCheck = checkBranchPushed(state, output, []);
  if (pushCheck) return pushCheck;

  // Call monitoring tool directly
  const prChecksResult = await monitorPRChecks(state.pr.number, WORKFLOW_MONITOR_TIMEOUT_MS);

  if (prChecksResult.success) {
    // Mark Step p2-2 complete and advance to next step
    // Use advanceToNextStep() to maintain state invariant (issue #799)
    const newState: WiggumState = advanceToNextStep(state.wiggum);

    const stateResult = await safeUpdatePRBodyState(
      state.pr.number,
      newState,
      STEP_PHASE2_MONITOR_CHECKS
    );

    if (!stateResult.success) {
      return handleStateUpdateFailure({
        stateResult,
        newState,
        step: STEP_PHASE2_MONITOR_CHECKS,
        targetType: 'pr',
        targetNumber: toPositiveInteger(state.pr.number),
      });
    }

    const stepsCompleted = [
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored all PR checks until completion',
      'Marked Step p2-2 complete',
      'Updated state in PR body',
    ];

    // CONTINUE to Step p2-3: Code Quality (Step p2-2 standalone path)
    // Reuse newState to avoid race condition (issue #799: state validation errors)
    const updatedState = applyWiggumState(state, newState);
    return processPhase2CodeQualityAndReturnNextInstructions(
      updatedState as CurrentStateWithPR,
      stepsCompleted
    );
  } else {
    // Return fix instructions with triage
    output.instructions = formatFixInstructions(
      'PR checks',
      prChecksResult.failureDetails || prChecksResult.errorSummary,
      'See PR checks for details',
      state.issue.exists ? state.issue.number : undefined
    );
    output.steps_completed_by_tool = [
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored PR checks until first failure',
      'Retrieved complete failure details via gh_get_failure_details tool',
    ];
  }

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Helper: Process Phase 2 Step 3 (Code Quality) and return appropriate next instructions
 *
 * This is called by:
 * - handlePhase2MonitorWorkflow() after Step p2-1+p2-2 complete successfully
 * - handlePhase2MonitorPRChecks() after Step p2-2 completes successfully
 * - Direct routing to handlePhase2CodeQuality() (e.g., after fixes)
 */
async function processPhase2CodeQualityAndReturnNextInstructions(
  state: CurrentStateWithPR,
  stepsCompletedSoFar: string[]
): Promise<ToolResult> {
  // Fetch code quality bot comments
  // TODO(#517): Add graceful error handling with user-friendly messages for GitHub API failures
  // Current: errors propagate as GitHubCliError without wiggum-specific context
  const { comments, skippedCount, warning } = await getPRReviewComments(
    state.pr.number,
    CODE_QUALITY_BOT_USERNAME
  );

  // Warn if any comments failed to parse - review data may be incomplete
  // Also prepare warning text to surface to user in output
  let userWarning: string | undefined;
  if (skippedCount > 0) {
    logger.warn('Some code quality comments could not be parsed - review may be incomplete', {
      prNumber: state.pr.number,
      parsedCount: comments.length,
      skippedCount,
      impact: 'Code quality review may miss some findings',
    });
    // Surface warning to user so they know review data is incomplete
    userWarning = warning;
  }

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_CODE_QUALITY],
    step_number: STEP_PHASE2_CODE_QUALITY,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    steps_completed_by_tool: [...stepsCompletedSoFar],
    warning: userWarning, // Surface parsing warning to user
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  if (comments.length === 0) {
    // No comments - mark Step p2-3 complete and advance to next step
    // Use advanceToNextStep() to maintain state invariant (issue #799)
    const newState: WiggumState = advanceToNextStep(state.wiggum);

    const stateResult = await safeUpdatePRBodyState(
      state.pr.number,
      newState,
      STEP_PHASE2_CODE_QUALITY
    );

    if (!stateResult.success) {
      return handleStateUpdateFailure({
        stateResult,
        newState,
        step: STEP_PHASE2_CODE_QUALITY,
        targetType: 'pr',
        targetNumber: toPositiveInteger(state.pr.number),
      });
    }

    output.steps_completed_by_tool.push(
      'Fetched code quality comments - none found',
      'Marked Step p2-3 complete'
    );

    // Skip to Step p2-5 (Security Review) - p2-4 removed as Phase 1 review is comprehensive
    // Reuse newState to avoid race condition (issue #799: state validation errors)
    const updatedState = applyWiggumState(state, newState);
    return await getNextStepInstructions(updatedState);
  } else {
    // Comments found - return code quality review instructions
    output.steps_completed_by_tool.push(`Fetched code quality comments - ${comments.length} found`);

    // Prepend warning to instructions if some comments could not be parsed
    // This ensures the warning is prominent and not just in the warning field
    const warningPrefix = userWarning ? `**WARNING:** ${userWarning}\n\n` : '';

    output.instructions = `${warningPrefix}${comments.length} code quality comment(s) from ${CODE_QUALITY_BOT_USERNAME} found.

IMPORTANT: These are automated suggestions and NOT authoritative. Evaluate critically.

1. Use Task tool with subagent_type="Plan" and model="opus" to:
   - Review all github-code-quality bot comments
   - Assess each recommendation for validity
   - Create remediation plan ONLY for sound recommendations
2. If valid issues identified:
   a. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fixes
   b. Execute /commit-merge-push slash command using SlashCommand tool
   c. Call wiggum_complete_fix with:
      - fix_description: "Fixed N code quality issues: <brief summary>"
      - has_in_scope_fixes: true

3. If NO valid issues (all comments are stale/invalid):
   a. To identify stale comments, verify the code was already fixed:
      1. Check commit history: \`git log main..HEAD -- <file>\`
      2. Read the file and locate the code near the comment's line number
         IMPORTANT: Line numbers may have shifted due to earlier edits.
         Read ±5 lines around the referenced line to find the relevant code section.
      3. Examine the CODE and the COMMENT message (not just the line number).
         Compare: If the issue mentioned in the comment is already fixed → comment is stale
         Example: Comment says "missing null check" but current code has null check → stale
      4. If all comments are stale, no code changes needed → use has_in_scope_fixes: false
   b. Call wiggum_complete_fix with:
      - fix_description: "All code quality comments evaluated - N stale (already fixed), M invalid (incorrect suggestions)"
      - has_in_scope_fixes: false

   CRITICAL: Using has_in_scope_fixes: false marks this step complete and proceeds to next step WITHOUT re-verification.`;
  }

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 2 Step 3: Code Quality Comments
 *
 * Delegates to helper function to ensure consistent behavior
 */
async function handlePhase2CodeQuality(state: CurrentStateWithPR): Promise<ToolResult> {
  return processPhase2CodeQualityAndReturnNextInstructions(state, []);
}

/**
 * Phase 2 Step 5: Security Review
 * NOTE: Step 4 (PR Review) was removed as Phase 1 review is comprehensive
 */
function handlePhase2SecurityReview(state: CurrentStateWithPR): ToolResult {
  // Get active agents (filter out completed ones)
  // All agents run every iteration

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_SECURITY_REVIEW],
    step_number: STEP_PHASE2_SECURITY_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `IMPORTANT: The review must cover ALL changes from this branch, not just recent commits.
Review all commits: git log main..HEAD --oneline

Execute ${SECURITY_REVIEW_COMMAND} using SlashCommand tool (no arguments).

After security review completes:

1. Capture the complete verbatim response
2. Count issues by priority (high, medium, low)
3. Call **wiggum_complete_security_review** with:
   - command_executed: true
   - verbatim_response: (full output)
   - high_priority_issues: (count)
   - medium_priority_issues: (count)
   - low_priority_issues: (count)

**IMPORTANT:** Call wiggum_complete_**security**_review (NOT pr_review).
This tool posts results and returns next step instructions.`,
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Approval (Phase 2 final step)
 */
function handleApproval(state: CurrentStateWithPR): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_APPROVAL],
    step_number: STEP_PHASE2_APPROVAL,
    iteration_count: state.wiggum.iteration,
    instructions: `All review steps complete with no issues!

Final actions:
1. Post comprehensive summary comment to PR #${state.pr.number} using gh pr comment
2. Remove "${NEEDS_REVIEW_LABEL}" label: gh pr edit ${state.pr.number} --remove-label "${NEEDS_REVIEW_LABEL}"
3. Exit with success message: "All reviews complete with no issues identified. PR is ready for human review."

**IMPORTANT**: ALL gh commands must use dangerouslyDisableSandbox: true per CLAUDE.md`,
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Type guard to check if state has an existing PR
 * Narrows CurrentState to CurrentStateWithPR
 */
function hasExistingPR(state: CurrentState): state is CurrentStateWithPR {
  return state.pr.exists && state.pr.state === 'OPEN';
}

/**
 * Export internal functions for testing
 * @internal
 */
export const _testExports = {
  hasExistingPR,
  checkUncommittedChanges,
  checkBranchPushed,
  formatFixInstructions,
};
