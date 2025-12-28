/**
 * Router: Determines next step instructions based on current state
 *
 * This module contains the routing logic that determines what action
 * should be taken next in the wiggum workflow. It's used by both
 * wiggum_init (at start) and completion tools (after each step).
 */

import { getPRReviewComments, sleep } from '../utils/gh-cli.js';
import { updatePRBodyState, updateIssueBodyState } from './body-state.js';
import { monitorRun, monitorPRChecks } from '../utils/gh-workflow.js';
import { logger } from '../utils/logger.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import type { WiggumState, CurrentState, PRExists } from './types.js';
import { addToCompletedSteps, applyWiggumState } from './state-utils.js';
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
  PHASE1_PR_REVIEW_COMMAND,
  SECURITY_REVIEW_COMMAND,
  NEEDS_REVIEW_LABEL,
  WORKFLOW_MONITOR_TIMEOUT_MS,
  generateWorkflowTriageInstructions,
} from '../constants.js';
import type { ToolResult } from '../types.js';
import { GitHubCliError } from '../utils/errors.js';
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
 * CONTEXT: This discriminated union supports race-safe state persistence (issue #388).
 * By distinguishing successful persistence from transient failures, callers can make
 * informed decisions about retrying vs halting the workflow when state updates fail.
 *
 * Provides expressive error handling with clear failure reasons:
 * - success: true - State updated successfully in PR/issue body
 * - success: false - Update failed due to transient error (rate limit or network)
 *
 * Transient errors are logged and cause workflow to halt gracefully with
 * actionable retry instructions. Critical errors (404, auth) are thrown immediately.
 *
 * Failure cases REQUIRE lastError and attemptCount for debugging (issue #625):
 * - lastError: The actual error from the final retry attempt (REQUIRED for diagnostics)
 * - attemptCount: Number of retry attempts made before failure (REQUIRED for retry analysis)
 *
 * Note: `isTransient: true` is always true for failure cases (rate_limit/network both imply
 * transient failures). This field is retained for API stability but is technically redundant.
 */
export type StateUpdateResult =
  | { success: true }
  | {
      success: false;
      reason: 'rate_limit' | 'network';
      isTransient: true;
      lastError: Error;
      attemptCount: number;
    };

/**
 * Create a StateUpdateResult failure with validated parameters
 *
 * Factory function that ensures invariants are met at construction time:
 * - attemptCount must be a positive integer
 * - lastError must be an Error instance
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
  return { success: false, reason, isTransient: true, lastError, attemptCount };
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
 * Internal helper: Check for uncommitted changes and return early exit if found
 *
 * This is an internal utility function used by multiple step handlers
 * (handleStepMonitorWorkflow, handleStepMonitorPRChecks) to validate
 * git state before proceeding with monitoring operations.
 *
 * @internal
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
 * Internal helper: Check if branch is pushed to remote and return early exit if not
 *
 * This is an internal utility function used by multiple step handlers
 * (handleStepMonitorWorkflow, handleStepMonitorPRChecks) to validate
 * git state before proceeding with monitoring operations.
 *
 * @internal
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
    output.instructions =
      'Branch not pushed to remote. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
    output.steps_completed_by_tool = [...stepsCompleted, 'Checked push status'];
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }
  return null;
}

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
  // Validate maxRetries to ensure loop executes at least once
  // This prevents the edge case where maxRetries < 1 would skip the loop entirely
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    logger.error('safeUpdatePRBodyState: Invalid maxRetries parameter', {
      prNumber,
      step,
      maxRetries,
      maxRetriesType: typeof maxRetries,
      phase: state.phase,
      impact: 'Cannot execute retry loop with invalid parameter',
    });
    throw new Error(
      `safeUpdatePRBodyState: maxRetries must be a positive integer, got: ${maxRetries} (type: ${typeof maxRetries})`
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
      // Known limitations (in priority order):
      // TODO(#320): Surface state persistence failures to users instead of silent warning (user-facing)
      // TODO(#415): Add type guards to catch blocks to avoid broad exception catching (type safety)
      // TODO(#468): Broad catch-all hides programming errors - add early type validation (related to #415)
      const errorMsg = updateError instanceof Error ? updateError.message : String(updateError);
      const exitCode = updateError instanceof GitHubCliError ? updateError.exitCode : undefined;
      const stderr = updateError instanceof GitHubCliError ? updateError.stderr : undefined;
      const stateJson = JSON.stringify(state);

      // Classify error type based on error message patterns and exit codes
      // TODO(#478): Document expected GitHub API error patterns and add test coverage
      // Note: Network errors use message pattern matching because exitCode values for network
      // failures (ECONNREFUSED, ETIMEDOUT, etc.) are not standardized and vary by tool/platform.
      // HTTP-related errors (404, 429, etc.) have reliable exitCode values from gh CLI.
      const is404 = /not found|404/i.test(errorMsg) || exitCode === 404;
      const isAuth =
        /permission|forbidden|unauthorized|401|403/i.test(errorMsg) ||
        exitCode === 401 ||
        exitCode === 403;
      const isRateLimit = /rate limit|429/i.test(errorMsg) || exitCode === 429;
      const isNetwork = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|fetch/i.test(errorMsg);

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
        // Include classification results for debugging
        classification: { is404, isAuth, isRateLimit, isNetwork },
      };

      // Critical errors: PR not found or authentication failures - throw immediately (no retry)
      if (is404) {
        logger.error('Critical: PR not found - cannot update state in body', {
          ...errorContext,
          impact: 'Workflow state persistence failed',
          recommendation: `Verify PR #${prNumber} exists: gh pr view ${prNumber}`,
          nextSteps: 'Workflow cannot continue without valid PR',
          isTransient: false,
        });
        throw updateError;
      }

      if (isAuth) {
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
      if (isRateLimit || isNetwork) {
        const reason = isRateLimit ? 'rate_limit' : 'network';

        if (attempt < maxRetries) {
          // Exponential backoff: 2^attempt seconds (2s, 4s, 8s for maxRetries=3)
          // Note: No cap on delay - with higher maxRetries, delays can grow large (16s, 32s, etc.)
          const delayMs = Math.pow(2, attempt) * 1000;
          logger.info('Transient error updating state - retrying with backoff', {
            ...errorContext,
            reason,
            delayMs,
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
  // Defensive: This should be unreachable if loop logic is correct.
  // The loop executes at least once (maxRetries >= 1), and each iteration either:
  //   1. Returns success after updatePRBodyState() succeeds
  //   2. Throws for critical errors (404, auth)
  //   3. Returns failure result after all retries exhausted (transient errors)
  //   4. Throws for unexpected errors (else branch in catch)
  // If reached, indicates a programming error in the retry logic above.
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
  // Validate maxRetries to ensure loop executes at least once
  // This prevents the edge case where maxRetries < 1 would skip the loop entirely
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    logger.error('safeUpdateIssueBodyState: Invalid maxRetries parameter', {
      issueNumber,
      step,
      maxRetries,
      maxRetriesType: typeof maxRetries,
      phase: state.phase,
      impact: 'Cannot execute retry loop with invalid parameter',
    });
    throw new Error(
      `safeUpdateIssueBodyState: maxRetries must be a positive integer, got: ${maxRetries} (type: ${typeof maxRetries})`
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

      // Classify error type based on error message patterns and exit codes
      // TODO(#478): Document expected GitHub API error patterns and add test coverage
      // Note: Network errors use message pattern matching because exitCode values for network
      // failures (ECONNREFUSED, ETIMEDOUT, etc.) are not standardized and vary by tool/platform.
      // HTTP-related errors (404, 429, etc.) have reliable exitCode values from gh CLI.
      const is404 = /not found|404/i.test(errorMsg) || exitCode === 404;
      const isAuth =
        /permission|forbidden|unauthorized|401|403/i.test(errorMsg) ||
        exitCode === 401 ||
        exitCode === 403;
      const isRateLimit = /rate limit|429/i.test(errorMsg) || exitCode === 429;
      const isNetwork = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|fetch/i.test(errorMsg);

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
        // Include classification results for debugging
        classification: { is404, isAuth, isRateLimit, isNetwork },
      };

      // Critical errors: Issue not found or authentication failures - throw immediately (no retry)
      if (is404) {
        logger.error('Critical: Issue not found - cannot update state in body', {
          ...errorContext,
          impact: 'Workflow state persistence failed',
          recommendation: `Verify issue #${issueNumber} exists: gh issue view ${issueNumber}`,
          nextSteps: 'Workflow cannot continue without valid issue',
          isTransient: false,
        });
        throw updateError;
      }

      if (isAuth) {
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
      if (isRateLimit || isNetwork) {
        const reason = isRateLimit ? 'rate_limit' : 'network';

        if (attempt < maxRetries) {
          // Exponential backoff: 2^attempt seconds (2s, 4s, 8s for maxRetries=3)
          // Note: No cap on delay - with higher maxRetries, delays can grow large (16s, 32s, etc.)
          const delayMs = Math.pow(2, attempt) * 1000;
          logger.info('Transient error updating state - retrying with backoff', {
            ...errorContext,
            reason,
            delayMs,
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
  // Defensive: This should be unreachable if loop logic is correct.
  // The loop executes at least once (maxRetries >= 1), and each iteration either:
  //   1. Returns success after updateIssueBodyState() succeeds
  //   2. Throws for critical errors (404, auth)
  //   3. Returns failure result after all retries exhausted (transient errors)
  //   4. Throws for unexpected errors (else branch in catch)
  // If reached, indicates a programming error in the retry logic above.
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
  // TODO(#417): Add logging when sanitization occurs to help debugging
  // Sanitize external input to prevent secret exposure and markdown issues
  // failureDetails comes from GitHub API responses (workflow logs, check outputs)
  const sanitizedDetails = failureDetails
    ? sanitizeErrorMessage(failureDetails, 1000)
    : defaultMessage;

  // If issueNumber provided, use triage workflow
  if (issueNumber !== undefined) {
    return generateWorkflowTriageInstructions(
      issueNumber,
      failureType as 'Workflow' | 'PR checks',
      sanitizedDetails
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
${sanitizedDetails}`;
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
    // Mark Step p1-1 complete (with deduplication)
    const newState: WiggumState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE1_MONITOR_WORKFLOW,
      completedSteps: addToCompletedSteps(
        state.wiggum.completedSteps,
        STEP_PHASE1_MONITOR_WORKFLOW
      ),
      phase: 'phase1',
    };

    const stateResult = await safeUpdateIssueBodyState(
      issueNumber,
      newState,
      STEP_PHASE1_MONITOR_WORKFLOW
    );

    if (!stateResult.success) {
      logger.error('Critical: State update failed - halting workflow', {
        issueNumber,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        iteration: newState.iteration,
        phase: newState.phase,
        reason: stateResult.reason,
        lastError: stateResult.lastError?.message,
        attemptCount: stateResult.attemptCount,
        impact: 'Race condition fix requires state persistence',
        recommendation: 'Retry after resolving rate limit/network issues',
      });

      // Build detailed error context for user-facing message
      const errorDetails = stateResult.lastError
        ? `\n\nActual error: ${stateResult.lastError.message}`
        : '';
      const retryInfo = stateResult.attemptCount
        ? `\n\nRetry attempts made: ${stateResult.attemptCount}`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: formatWiggumResponse({
              current_step: STEP_NAMES[STEP_PHASE1_MONITOR_WORKFLOW],
              step_number: STEP_PHASE1_MONITOR_WORKFLOW,
              iteration_count: newState.iteration,
              instructions: `ERROR: Failed to update state in issue #${issueNumber} body. The race condition fix requires state persistence.\n\nFailure reason: ${stateResult.reason}${errorDetails}${retryInfo}\n\nThis is typically caused by:\n- GitHub API rate limiting (429)\n- Network connectivity issues\n- Temporary GitHub API unavailability\n\nPlease retry after:\n1. Checking rate limits: \`gh api rate_limit\`\n2. Verifying network connectivity\n3. Confirming issue #${issueNumber} exists: \`gh issue view ${issueNumber}\`\n\nThe workflow will resume from this step once the issue is resolved.`,
              steps_completed_by_tool: [
                'Attempted to update state in body',
                `Failed due to ${stateResult.reason} after ${stateResult.attemptCount ?? 'unknown'} attempts`,
              ],
              context: {},
            }),
          },
        ],
        isError: true,
      };
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
    const newState = {
      iteration: state.wiggum.iteration + 1,
      step: STEP_PHASE1_MONITOR_WORKFLOW,
      completedSteps: state.wiggum.completedSteps,
      phase: 'phase1' as const,
    };

    const stateResult = await safeUpdateIssueBodyState(
      issueNumber,
      newState,
      STEP_PHASE1_MONITOR_WORKFLOW
    );

    if (!stateResult.success) {
      logger.error('Critical: State update failed - halting workflow', {
        issueNumber,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        iteration: newState.iteration,
        phase: newState.phase,
        reason: stateResult.reason,
        lastError: stateResult.lastError?.message,
        attemptCount: stateResult.attemptCount,
        impact: 'Race condition fix requires state persistence',
        recommendation: 'Retry after resolving rate limit/network issues',
      });

      // Build detailed error context for user-facing message
      const errorDetails = stateResult.lastError
        ? `\n\nActual error: ${stateResult.lastError.message}`
        : '';
      const retryInfo = stateResult.attemptCount
        ? `\n\nRetry attempts made: ${stateResult.attemptCount}`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: formatWiggumResponse({
              current_step: STEP_NAMES[STEP_PHASE1_MONITOR_WORKFLOW],
              step_number: STEP_PHASE1_MONITOR_WORKFLOW,
              iteration_count: newState.iteration,
              instructions: `ERROR: Failed to update state in issue #${issueNumber} body. The race condition fix requires state persistence.\n\nFailure reason: ${stateResult.reason}${errorDetails}${retryInfo}\n\nThis is typically caused by:\n- GitHub API rate limiting (429)\n- Network connectivity issues\n- Temporary GitHub API unavailability\n\nPlease retry after:\n1. Checking rate limits: \`gh api rate_limit\`\n2. Verifying network connectivity\n3. Confirming issue #${issueNumber} exists: \`gh issue view ${issueNumber}\`\n\nThe workflow will resume from this step once the issue is resolved.`,
              steps_completed_by_tool: [
                'Attempted to update state in body',
                `Failed due to ${stateResult.reason} after ${stateResult.attemptCount ?? 'unknown'} attempts`,
              ],
              context: {},
            }),
          },
        ],
        isError: true,
      };
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
function handlePhase1PRReview(state: CurrentState, issueNumber: number): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_PR_REVIEW],
    step_number: STEP_PHASE1_PR_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `## Step 2: PR Review (Before PR Creation)

Execute comprehensive PR review on the current branch before creating the pull request.

**Instructions:**

1. Execute the PR review command:
   \`\`\`
   ${PHASE1_PR_REVIEW_COMMAND}
   \`\`\`

2. After the review completes, aggregate results from all agents:
   - Collect in_scope_file paths from each agent's JSON response
   - Collect out_of_scope_file paths from each agent's JSON response
   - Sum in_scope_count across all agents
   - Sum out_of_scope_count across all agents

3. Call the \`wiggum_complete_pr_review\` tool with:
   - command_executed: true
   - in_scope_files: [array of file paths from all agents]
   - out_of_scope_files: [array of file paths from all agents]
   - in_scope_count: (total count of in-scope issues, NOT files)
   - out_of_scope_count: (total count of out-of-scope issues, NOT files)

   **IMPORTANT:** Counts represent ISSUES, not FILES. Each file may contain multiple issues.

4. Results will be posted to issue #${issueNumber}

5. If issues are found:
   - You will be instructed to fix them (Plan + Fix cycle)
   - After fixes, workflow restarts from Step p1-1

6. If no issues:
   - Proceed to Step p1-3 (Security Review - Pre-PR)`,
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
   - Collect in_scope_file paths from each agent's JSON response
   - Collect out_of_scope_file paths from each agent's JSON response
   - Sum in_scope_count across all agents
   - Sum out_of_scope_count across all agents

3. Call the \`wiggum_complete_security_review\` tool with:
   - command_executed: true
   - in_scope_files: [array of file paths from all agents]
   - out_of_scope_files: [array of file paths from all agents]
   - in_scope_count: (total count of in-scope security issues, NOT files)
   - out_of_scope_count: (total count of out-of-scope security issues, NOT files)

   **IMPORTANT:** Counts represent ISSUES, not FILES. Each file may contain multiple issues.

4. Results will be posted to issue #${issueNumber}

5. If issues are found:
   - You will be instructed to fix them (Plan + Fix cycle)
   - After fixes, workflow restarts from Step p1-1

6. If no issues:
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
    // Mark Step p2-1 complete (with deduplication)
    const newState: WiggumState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE2_MONITOR_WORKFLOW,
      completedSteps: addToCompletedSteps(
        state.wiggum.completedSteps,
        STEP_PHASE2_MONITOR_WORKFLOW
      ),
      phase: 'phase2',
    };

    const stateResult = await safeUpdatePRBodyState(
      state.pr.number,
      newState,
      STEP_PHASE2_MONITOR_WORKFLOW
    );

    if (!stateResult.success) {
      logger.error('Critical: State update failed - halting workflow', {
        prNumber: state.pr.number,
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        iteration: newState.iteration,
        phase: newState.phase,
        reason: stateResult.reason,
        lastError: stateResult.lastError?.message,
        attemptCount: stateResult.attemptCount,
        impact: 'Race condition fix requires state persistence',
        recommendation: 'Retry after resolving rate limit/network issues',
      });

      // Build detailed error context for user-facing message
      const errorDetails = stateResult.lastError
        ? `\n\nActual error: ${stateResult.lastError.message}`
        : '';
      const retryInfo = stateResult.attemptCount
        ? `\n\nRetry attempts made: ${stateResult.attemptCount}`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: formatWiggumResponse({
              current_step: STEP_NAMES[STEP_PHASE2_MONITOR_WORKFLOW],
              step_number: STEP_PHASE2_MONITOR_WORKFLOW,
              iteration_count: newState.iteration,
              instructions: `ERROR: Failed to update state in PR #${state.pr.number} body. The race condition fix requires state persistence.\n\nFailure reason: ${stateResult.reason}${errorDetails}${retryInfo}\n\nThis is typically caused by:\n- GitHub API rate limiting (429)\n- Network connectivity issues\n- Temporary GitHub API unavailability\n\nPlease retry after:\n1. Checking rate limits: \`gh api rate_limit\`\n2. Verifying network connectivity\n3. Confirming PR #${state.pr.number} exists: \`gh pr view ${state.pr.number}\`\n\nThe workflow will resume from this step once the issue is resolved.`,
              steps_completed_by_tool: [
                'Attempted to update state in body',
                `Failed due to ${stateResult.reason} after ${stateResult.attemptCount ?? 'unknown'} attempts`,
              ],
              context: { pr_number: state.pr.number },
            }),
          },
        ],
        isError: true,
      };
    }

    const stepsCompleted = [
      'Monitored workflow run until completion',
      'Marked Step p2-1 complete',
      'Updated state in PR body',
    ];

    // CONTINUE to Step p2-2: Monitor PR checks (within same function call)
    // Reuse newState to avoid race condition with GitHub API (issue #388)
    // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
    // state changes have occurred (PR closed, commits added, issue modified). This is safe
    // during inline step transitions within the same tool call. For state staleness validation,
    // see issue #391.
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
        updatedState.issue.number
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

    // PR checks succeeded - mark Step p2-2 complete (with deduplication)
    const newState2: WiggumState = {
      iteration: updatedState.wiggum.iteration,
      step: STEP_PHASE2_MONITOR_CHECKS,
      completedSteps: addToCompletedSteps(
        updatedState.wiggum.completedSteps,
        STEP_PHASE2_MONITOR_CHECKS
      ),
      phase: 'phase2',
    };

    const stateResult2 = await safeUpdatePRBodyState(
      state.pr.number,
      newState2,
      STEP_PHASE2_MONITOR_CHECKS
    );

    if (!stateResult2.success) {
      logger.error('Critical: State update failed - halting workflow', {
        prNumber: state.pr.number,
        step: STEP_PHASE2_MONITOR_CHECKS,
        iteration: newState2.iteration,
        phase: newState2.phase,
        reason: stateResult2.reason,
        lastError: stateResult2.lastError?.message,
        attemptCount: stateResult2.attemptCount,
        impact: 'Race condition fix requires state persistence',
        recommendation: 'Retry after resolving rate limit/network issues',
      });

      // Build detailed error context for user-facing message
      const errorDetails = stateResult2.lastError
        ? `\n\nActual error: ${stateResult2.lastError.message}`
        : '';
      const retryInfo = stateResult2.attemptCount
        ? `\n\nRetry attempts made: ${stateResult2.attemptCount}`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: formatWiggumResponse({
              current_step: STEP_NAMES[STEP_PHASE2_MONITOR_CHECKS],
              step_number: STEP_PHASE2_MONITOR_CHECKS,
              iteration_count: newState2.iteration,
              instructions: `ERROR: Failed to update state in PR #${state.pr.number} body. The race condition fix requires state persistence.\n\nFailure reason: ${stateResult2.reason}${errorDetails}${retryInfo}\n\nThis is typically caused by:\n- GitHub API rate limiting (429)\n- Network connectivity issues\n- Temporary GitHub API unavailability\n\nPlease retry after:\n1. Checking rate limits: \`gh api rate_limit\`\n2. Verifying network connectivity\n3. Confirming PR #${state.pr.number} exists: \`gh pr view ${state.pr.number}\`\n\nThe workflow will resume from this step once the issue is resolved.`,
              steps_completed_by_tool: [
                'Attempted to update state in body',
                `Failed due to ${stateResult2.reason} after ${stateResult2.attemptCount ?? 'unknown'} attempts`,
              ],
              context: { pr_number: state.pr.number },
            }),
          },
        ],
        isError: true,
      };
    }

    stepsCompleted.push(
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored all PR checks until completion',
      'Marked Step p2-2 complete',
      'Updated state in PR body'
    );

    // CONTINUE to Step p2-3: Code Quality
    // Reuse newState2 to avoid race condition with GitHub API (issue #388)
    // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
    // state changes have occurred (PR closed, commits added, issue modified). This is safe
    // during inline step transitions within the same tool call. For state staleness validation,
    // see issue #391.
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
      state.issue.number
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
    // Mark Step p2-2 complete (with deduplication)
    const newState: WiggumState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE2_MONITOR_CHECKS,
      completedSteps: addToCompletedSteps(state.wiggum.completedSteps, STEP_PHASE2_MONITOR_CHECKS),
      phase: 'phase2',
    };

    const stateResult = await safeUpdatePRBodyState(
      state.pr.number,
      newState,
      STEP_PHASE2_MONITOR_CHECKS
    );

    if (!stateResult.success) {
      logger.error('Critical: State update failed - halting workflow', {
        prNumber: state.pr.number,
        step: STEP_PHASE2_MONITOR_CHECKS,
        iteration: newState.iteration,
        phase: newState.phase,
        reason: stateResult.reason,
        lastError: stateResult.lastError?.message,
        attemptCount: stateResult.attemptCount,
        impact: 'Race condition fix requires state persistence',
        recommendation: 'Retry after resolving rate limit/network issues',
      });

      // Build detailed error context for user-facing message
      const errorDetails = stateResult.lastError
        ? `\n\nActual error: ${stateResult.lastError.message}`
        : '';
      const retryInfo = stateResult.attemptCount
        ? `\n\nRetry attempts made: ${stateResult.attemptCount}`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: formatWiggumResponse({
              current_step: STEP_NAMES[STEP_PHASE2_MONITOR_CHECKS],
              step_number: STEP_PHASE2_MONITOR_CHECKS,
              iteration_count: newState.iteration,
              instructions: `ERROR: Failed to update state in PR #${state.pr.number} body. The race condition fix requires state persistence.\n\nFailure reason: ${stateResult.reason}${errorDetails}${retryInfo}\n\nThis is typically caused by:\n- GitHub API rate limiting (429)\n- Network connectivity issues\n- Temporary GitHub API unavailability\n\nPlease retry after:\n1. Checking rate limits: \`gh api rate_limit\`\n2. Verifying network connectivity\n3. Confirming PR #${state.pr.number} exists: \`gh pr view ${state.pr.number}\`\n\nThe workflow will resume from this step once the issue is resolved.`,
              steps_completed_by_tool: [
                'Attempted to update state in body',
                `Failed due to ${stateResult.reason} after ${stateResult.attemptCount ?? 'unknown'} attempts`,
              ],
              context: { pr_number: state.pr.number },
            }),
          },
        ],
        isError: true,
      };
    }

    const stepsCompleted = [
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored all PR checks until completion',
      'Marked Step p2-2 complete',
      'Updated state in PR body',
    ];

    // CONTINUE to Step p2-3: Code Quality (Step p2-2 standalone path)
    // Reuse newState to avoid race condition with GitHub API (issue #388)
    // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
    // state changes have occurred (PR closed, commits added, issue modified). This is safe
    // during inline step transitions within the same tool call. For state staleness validation,
    // see issue #391.
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
      state.issue.number
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
  const { comments, skippedCount } = await getPRReviewComments(
    state.pr.number,
    CODE_QUALITY_BOT_USERNAME
  );

  // Warn if any comments failed to parse - review data may be incomplete
  if (skippedCount > 0) {
    logger.warn('Some code quality comments could not be parsed - review may be incomplete', {
      prNumber: state.pr.number,
      parsedCount: comments.length,
      skippedCount,
      impact: 'Code quality review may miss some findings',
    });
  }

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_CODE_QUALITY],
    step_number: STEP_PHASE2_CODE_QUALITY,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    steps_completed_by_tool: [...stepsCompletedSoFar],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  if (comments.length === 0) {
    // No comments - mark Step p2-3 complete and return Step p2-4 (PR Review) instructions
    const newState: WiggumState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE2_CODE_QUALITY,
      completedSteps: addToCompletedSteps(state.wiggum.completedSteps, STEP_PHASE2_CODE_QUALITY),
      phase: 'phase2',
    };

    const stateResult = await safeUpdatePRBodyState(
      state.pr.number,
      newState,
      STEP_PHASE2_CODE_QUALITY
    );

    if (!stateResult.success) {
      logger.error('Critical: State update failed - halting workflow', {
        prNumber: state.pr.number,
        step: STEP_PHASE2_CODE_QUALITY,
        iteration: newState.iteration,
        phase: newState.phase,
        reason: stateResult.reason,
        lastError: stateResult.lastError?.message,
        attemptCount: stateResult.attemptCount,
        impact: 'Race condition fix requires state persistence',
        recommendation: 'Retry after resolving rate limit/network issues',
      });

      // Build detailed error context for user-facing message
      const errorDetails = stateResult.lastError
        ? `\n\nActual error: ${stateResult.lastError.message}`
        : '';
      const retryInfo = stateResult.attemptCount
        ? `\n\nRetry attempts made: ${stateResult.attemptCount}`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: formatWiggumResponse({
              current_step: STEP_NAMES[STEP_PHASE2_CODE_QUALITY],
              step_number: STEP_PHASE2_CODE_QUALITY,
              iteration_count: newState.iteration,
              instructions: `ERROR: Failed to update state in PR #${state.pr.number} body. The race condition fix requires state persistence.\n\nFailure reason: ${stateResult.reason}${errorDetails}${retryInfo}\n\nThis is typically caused by:\n- GitHub API rate limiting (429)\n- Network connectivity issues\n- Temporary GitHub API unavailability\n\nPlease retry after:\n1. Checking rate limits: \`gh api rate_limit\`\n2. Verifying network connectivity\n3. Confirming PR #${state.pr.number} exists: \`gh pr view ${state.pr.number}\`\n\nThe workflow will resume from this step once the issue is resolved.`,
              steps_completed_by_tool: [
                'Attempted to update state in body',
                `Failed due to ${stateResult.reason} after ${stateResult.attemptCount ?? 'unknown'} attempts`,
              ],
              context: { pr_number: state.pr.number },
            }),
          },
        ],
        isError: true,
      };
    }

    output.steps_completed_by_tool.push(
      'Fetched code quality comments - none found',
      'Marked Step p2-3 complete'
    );

    // Skip to Step p2-5 (Security Review) - p2-4 was removed as Phase 1 review is comprehensive
    // Reuse the newState we just posted to avoid race condition with GitHub API (issue #388)
    const updatedState = applyWiggumState(state, newState);
    return await getNextStepInstructions(updatedState);
  } else {
    // Comments found - return code quality review instructions
    output.steps_completed_by_tool.push(`Fetched code quality comments - ${comments.length} found`);
    output.instructions = `${comments.length} code quality comment(s) from ${CODE_QUALITY_BOT_USERNAME} found.

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
