/**
 * Router: Determines next step instructions based on current state
 *
 * This module contains the routing logic that determines what action
 * should be taken next in the wiggum workflow. It's used by both
 * wiggum_init (at start) and completion tools (after each step).
 */

// TODO(#1859): Add context to TODO comments - future developers need brief explanations of what each TODO tracks
// TODO(#942): Extract verbose error handling pattern in router.ts state update failures
// TODO(#932): Add retry history tracking to StateUpdateResult for better diagnostics
// TODO(#858): Improve state update retry loop error context capture
// TODO(#811): Extract verbose state update error message formatting
// TODO(#716): Migrate error classification in router.ts to structured error types
// TODO(#710): Extract type alias for TransientFailureReason
import { getPRReviewComments, sleep } from '../utils/gh-cli.js';
import { updatePRBodyState, updateIssueBodyState } from './body-state.js';
import { monitorRun, monitorPRChecks } from '../utils/gh-workflow.js';
import { logger } from '../utils/logger.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { handleStateUpdateFailure } from './state-update-error-handler.js';
import type { WiggumState, CurrentState, PRExists } from './types.js';
import { WiggumStateSchema, createWiggumState, isIssueExists } from './types.js';
import { applyWiggumState } from './state-utils.js';
import { advanceToNextStep } from './transitions.js';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
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
// TODO(#1847): hasExistingPR type guard checks pr.state unnecessarily, narrower than type definition
type CurrentStateWithPR = CurrentState & {
  pr: PRExists;
};

/**
 * Configuration for resource-specific state update operations
 *
 * This discriminated union enables the generic safeUpdateBodyState function to
 * operate on both PRs and issues with resource-specific behavior for:
 * - Error messages and logging (using resourceLabel, resourceType)
 * - Error context tracking (using resourceType, resourceId)
 * - Verification commands (using verifyCommand)
 * - State persistence (using updateFn)
 *
 * Each union variant uses literal string types (e.g., 'pr', 'PR', 'gh pr view') to
 * enforce consistency between resourceType, resourceLabel, and verifyCommand at compile
 * time. TypeScript prevents mismatched combinations like { resourceType: 'pr', resourceLabel: 'Issue' }.
 *
 * Resolves TODO(#941) and TODO(#810): Consolidates duplicate state update pattern.
 */
// TODO(#1898): Simplify ResourceConfig discriminated union
// TODO(#1903): Consider branded types for resource IDs to enforce config-to-resourceId relationship at compile time
type ResourceConfig =
  | {
      readonly resourceType: 'pr';
      readonly resourceLabel: 'PR';
      readonly verifyCommand: 'gh pr view';
      readonly updateFn: (prNumber: number, state: WiggumState) => Promise<void>;
    }
  | {
      readonly resourceType: 'issue';
      readonly resourceLabel: 'Issue';
      readonly verifyCommand: 'gh issue view';
      readonly updateFn: (issueNumber: number, state: WiggumState) => Promise<void>;
    };

/**
 * Configuration for PR state updates
 */
const PR_CONFIG: ResourceConfig = {
  resourceType: 'pr',
  resourceLabel: 'PR',
  verifyCommand: 'gh pr view',
  updateFn: updatePRBodyState,
};

/**
 * Configuration for issue state updates
 */
const ISSUE_CONFIG: ResourceConfig = {
  resourceType: 'issue',
  resourceLabel: 'Issue',
  verifyCommand: 'gh issue view',
  updateFn: updateIssueBodyState,
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
// TODO(#1880): Consider using branded types for attemptCount to enforce positive integers at type level
export type StateUpdateResult =
  | { readonly success: true }
  | {
      readonly success: false;
      readonly reason: 'rate_limit' | 'network';
      readonly lastError: Error;
      readonly attemptCount: number;
    };

/**
 * Type alias for state update function signature.
 *
 * State update functions are side-effecting operations that persist WiggumState
 * to GitHub resource bodies (PR or issue). They should validate parameters and
 * throw GitHubCliError on API failures.
 *
 * @param id - Positive integer resource identifier (PR or issue number)
 * @param state - Valid WiggumState to persist to resource body
 * @param repo - Optional repository in "owner/repo" format (defaults to current repo)
 * @returns Promise that resolves when state is successfully persisted
 * @throws GitHubCliError on GitHub API failures
 * @throws ValidationError if parameters are invalid
 *
 * Note: This is a side-effecting function that mutates external GitHub state.
 */
type StateUpdateFn = (id: number, state: WiggumState, repo?: string) => Promise<void>;

/**
 * Configuration for state update operations.
 * Encapsulates resource-specific differences (PR vs issue) through dependency injection,
 * allowing executeStateUpdateWithRetry to handle both uniformly.
 *
 * @property resourceType - Type of GitHub resource ('pr' or 'issue')
 * @property resourceId - Positive integer resource identifier
 * @property updateFn - Function that updates the resource's body state.
 *                     Called with (id: number, state: WiggumState).
 *                     The public wrappers (safeUpdatePRBodyState/safeUpdateIssueBodyState)
 *                     provide updateFn implementations that use the default repo.
 *
 * Note: executeStateUpdateWithRetry derives resourceLabel, verifyCommand, and
 * error context field names from the resourceType and resourceId provided in this config.
 *
 * Implementation note: All fields use readonly modifiers to prevent field reassignment.
 */
interface StateUpdateConfig {
  readonly resourceType: 'pr' | 'issue';
  readonly resourceId: number;
  readonly updateFn: StateUpdateFn;
}

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

/**
 * Safely log a message with fallback to console on error
 *
 * Prevents logger failures from masking original errors in catch blocks.
 * On logger failure, falls back to console.error, then process.stderr.write
 * to ensure critical errors are always visible.
 */
// TODO(#1874): Overly nested fallback in safeLog could be simplified with early returns
function safeLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown>
): void {
  try {
    logger[level](message, context);
  } catch (loggingError) {
    try {
      console.error('CRITICAL: Logger failed', {
        level,
        message,
        context,
        loggingError: loggingError instanceof Error ? loggingError.message : String(loggingError),
      });
    } catch (consoleError) {
      // Last resort: stderr
      try {
        process.stderr.write(`CRITICAL: Logger and console.error failed - ${message}\n`);
      } catch (stderrError) {
        // All logging fallbacks exhausted - store for postmortem debugging
        // TODO(#653): Silent failure in safeLog when all logging mechanisms fail
        if (typeof globalThis !== 'undefined') {
          (globalThis as any).__unloggedErrors = (globalThis as any).__unloggedErrors || [];
          (globalThis as any).__unloggedErrors.push({ level, message, context });
        }
      }
    }
  }
}

/**
 * Safely serialize value to JSON with fallback on error
 *
 * On serialization failure, attempts to extract partial WiggumState properties
 * (phase, step, iteration, completedSteps count) for debugging. For non-WiggumState
 * objects, falls back to generic error message.
 *
 * @param value - Value to serialize (typically WiggumState)
 * @param label - Label for the value in error messages (e.g., "state", "fallback-state")
 * @returns JSON string, or on failure, a formatted string with partial state info or error details
 *
 * TODO(#1850): Extract individual state properties separately to preserve as much info as possible when partial extraction fails
 */
function safeStringify(value: unknown, label: string): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    // Try partial extraction for known state objects
    if (value && typeof value === 'object' && 'phase' in value) {
      try {
        const state = value as WiggumState;
        return `<partial ${label}: phase=${state.phase}, step=${state.step}, iteration=${state.iteration}, completedSteps=${state.completedSteps?.length ?? 0} items>`;
      } catch (partialError) {
        // Partial extraction failed - return explicit failure message
        const partialErrorMsg =
          partialError instanceof Error ? partialError.message : String(partialError);
        safeLog('warn', `Partial state extraction failed for ${label}`, {
          error: partialErrorMsg,
          hasPhaseProperty: value && typeof value === 'object' && 'phase' in value,
        });
        // Return explicit message about partial extraction failure
        return `<partial extraction failed: ${partialErrorMsg}>`;
      }
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    safeLog('warn', `Failed to serialize ${label}`, {
      error: errorMsg,
      valueType: typeof value,
      valueConstructor: value?.constructor?.name,
    });
    return `<serialization failed: ${errorMsg}>`;
  }
}

/**
 * Generic state update with retry logic for both PR and issue bodies
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
 * @param config - Configuration for the specific resource type (PR or issue)
 * @param state - New wiggum state to save
 * @param step - Step identifier for logging context
 * @param maxRetries - Maximum retry attempts for transient failures
 * @returns Result indicating success or transient failure with reason
 * @throws Critical errors (404, 401/403) and unexpected errors
 */
async function executeStateUpdateWithRetry(
  config: StateUpdateConfig,
  state: WiggumState,
  step: string,
  maxRetries: number
): Promise<StateUpdateResult> {
  const { resourceType, resourceId, updateFn } = config;
  const functionName = 'executeStateUpdateWithRetry';

  // Validate resourceType is allowed value
  if (resourceType !== 'pr' && resourceType !== 'issue') {
    throw new ValidationError(
      `${functionName}: config.resourceType must be 'pr' or 'issue', got: ${resourceType} (type: ${typeof resourceType})`
    );
  }

  // Compute display labels and field names based on resource type
  const resourceTypeName = resourceType === 'pr' ? 'PR' : 'Issue';
  const resourceLabel = `${resourceTypeName} #${resourceId}`;
  const verifyCommand = `gh ${resourceType} view ${resourceId}`;
  const resourceIdField = resourceType === 'pr' ? 'prNumber' : 'issueNumber';

  // Validate config.updateFn is actually a function
  if (typeof updateFn !== 'function') {
    throw new ValidationError(
      `${functionName}: config.updateFn must be a function, got: ${typeof updateFn}`
    );
  }

  // Validate resourceId parameter (must be positive integer)
  // This validation happens upfront to fail fast with clear error message.
  // Prevents invalid resourceId from causing StateApiError.create() failures in error handling paths.
  // Invalid resourceId would cause StateApiError.create() to throw, making error handling fail
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    throw new ValidationError(
      `${functionName} (${resourceTypeName}): ${resourceIdField} must be a positive integer, got: ${resourceId} (type: ${typeof resourceId})`
    );
  }

  // Validate maxRetries to ensure retry loop executes correctly (issue #625)
  // CRITICAL: Invalid maxRetries would break retry logic:
  //   - maxRetries < 1: Loop would not execute (no retries attempted)
  //   - maxRetries > 100: Excessive delays due to uncapped exponential backoff (attempt 10 = ~17 min)
  //   - Non-integer (0.5, NaN, Infinity): Unpredictable loop behavior
  const MAX_RETRIES_LIMIT = 100;
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > MAX_RETRIES_LIMIT) {
    logger.error(`${functionName}: Invalid maxRetries parameter`, {
      [resourceIdField]: resourceId,
      step,
      maxRetries,
      maxRetriesType: typeof maxRetries,
      phase: state.phase,
      impact: 'Cannot execute retry loop with invalid parameter',
    });
    throw new Error(
      `${functionName} (${resourceTypeName}): maxRetries must be a positive integer between 1 and ${MAX_RETRIES_LIMIT}, ` +
        `got: ${maxRetries} (type: ${typeof maxRetries}). ` +
        `Common values: 3 (default), 5 (flaky operations), 10 (very flaky). ` +
        `Values > 10 may indicate excessive retry tolerance that masks systemic issues.`
    );
  }

  // Validate state before attempting to post (issue #799: state validation errors)
  // This catches invalid states early and provides clear error messages rather than
  // opaque GitHub API errors when posting malformed state to body
  try {
    WiggumStateSchema.parse(state);
  } catch (validationError) {
    const { details, originalError } = extractZodValidationDetails(validationError, {
      [resourceIdField]: resourceId,
      step,
    });

    logger.error(`${functionName}: State validation failed before posting`, {
      [resourceIdField]: resourceId,
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
      resourceType,
      resourceId,
      originalError ?? new Error(String(validationError))
    );
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await updateFn(resourceId, state);

      // Log recovery on retry success
      // TODO(#1871): Consider escalating log level based on retry count for better operational visibility
      if (attempt > 1) {
        logger.info('State update succeeded after retry', {
          [resourceIdField]: resourceId,
          step,
          attempt,
          maxRetries,
          impact: 'Transient failure recovered automatically',
        });
      }

      return { success: true };
    } catch (updateError) {
      // Type guard: Handle ALL non-Error values thrown (primitives, objects, null, undefined)
      // Note: GitHubCliError extends Error, so it passes through this check
      if (!(updateError instanceof Error)) {
        const wrappedError = new Error(
          `Non-Error value thrown in ${functionName}: ${String(updateError)}`
        );
        safeLog('error', `CRITICAL: Non-Error value thrown in ${functionName}`, {
          [resourceIdField]: resourceId,
          step,
          thrownValue: updateError,
          thrownType: typeof updateError,
          isNull: updateError === null,
          isUndefined: updateError === undefined,
          constructor: updateError?.constructor?.name,
        });
        throw wrappedError;
      }

      // State update is CRITICAL for race condition fix (issue #388)
      // Classify errors to distinguish transient (rate limit, network) from critical (404, auth)
      //
      // Known limitations:
      // TODO(#1684): Surface state persistence failures to users instead of silent warning (user-facing)
      // TODO(#415): Add type guards to catch blocks to avoid broad exception catching (type safety)
      // TODO(#468): Broad catch-all hides programming errors - add early type validation (related to #415)
      const errorMsg = updateError.message;
      const exitCode = updateError instanceof GitHubCliError ? updateError.exitCode : undefined;
      const stderr = updateError instanceof GitHubCliError ? updateError.stderr : undefined;

      // Safe JSON serialization with error handling
      // Uses safeStringify helper to extract partial state on serialization failure
      const stateJson = safeStringify(state, 'state');

      // Classify error type using shared utility
      // If classification fails, use conservative fallback (no retry) to avoid misclassifying errors
      // TODO(#940): Document expected GitHub API error patterns and add test coverage
      let classification: ReturnType<typeof classifyGitHubError>;
      try {
        classification = classifyGitHubError(updateError, exitCode);
      } catch (classificationError) {
        safeLog('error', `CRITICAL: Error classification failed in ${functionName}`, {
          [resourceIdField]: resourceId,
          step,
          originalError: errorMsg,
          originalErrorStack: updateError.stack,
          classificationError:
            classificationError instanceof Error
              ? classificationError.message
              : String(classificationError),
          classificationErrorStack:
            classificationError instanceof Error ? classificationError.stack : undefined,
        });

        // Fallback classification: treat as unexpected (no retry)
        // Conservative approach - don't retry if we can't classify the error
        // TODO: Consider treating classification failures as potentially transient for conservative retry
        classification = {
          is404: false,
          isAuth: false,
          isRateLimit: false,
          isNetwork: false,
          isCritical: false,
          isTransient: false,
        };

        safeLog('warn', 'Using fallback error classification (no retry)', {
          [resourceIdField]: resourceId,
          step,
          originalError: errorMsg,
        });
      }

      // Build error context including classification results for debugging
      const errorContext = {
        [resourceIdField]: resourceId,
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

      // Critical errors: Resource not found or authentication failures - throw immediately (no retry)
      if (classification.is404) {
        safeLog('error', `Critical: ${resourceTypeName} not found - cannot update state in body`, {
          ...errorContext,
          impact: 'Workflow state persistence failed',
          recommendation: `Verify ${resourceLabel} exists: ${verifyCommand}`,
          nextSteps: `Workflow cannot continue without valid ${resourceType}`,
          isTransient: false,
        });
        throw updateError;
      }

      if (classification.isAuth) {
        safeLog('error', 'Critical: Authentication failed - cannot update state in body', {
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
          // Exponential backoff: 2^attempt seconds, capped at 60s to balance recovery time vs user experience
          const MAX_DELAY_MS = 60000;
          const uncappedDelayMs = Math.pow(2, attempt) * 1000;

          // Validate uncapped delay to catch corrupted attempt counter early
          // Invalid uncappedDelayMs indicates programming error in retry logic
          if (!Number.isFinite(uncappedDelayMs) || uncappedDelayMs < 0) {
            safeLog(
              'error',
              'CRITICAL: Invalid uncapped delay calculated - retry logic corrupted',
              {
                [resourceIdField]: resourceId,
                step,
                uncappedDelayMs,
                attempt,
                maxRetries,
                attemptType: typeof attempt,
              }
            );
            throw new Error(
              `INTERNAL ERROR: Invalid uncapped delay calculated (${uncappedDelayMs}ms) from attempt ${attempt}. ` +
                `This indicates a bug in the retry loop counter. Expected: positive finite number.`
            );
          }

          const delayMs = Math.min(uncappedDelayMs, MAX_DELAY_MS);
          // Note: delayMs is guaranteed ≤ MAX_DELAY_MS and finite due to Math.min() with validated uncappedDelayMs

          safeLog('info', 'Transient error updating state - retrying with backoff', {
            ...errorContext,
            reason,
            delayMs,
            wasCapped: uncappedDelayMs > MAX_DELAY_MS,
            remainingAttempts: maxRetries - attempt,
          });

          // TODO(#1846): Distinguish between expected sleep interruptions and unexpected failures
          // Explicit error handling for sleep to prevent misclassification
          try {
            await sleep(delayMs);
          } catch (sleepError) {
            safeLog('error', 'CRITICAL: sleep() failed during retry backoff', {
              [resourceIdField]: resourceId,
              step,
              delayMs,
              attempt,
              sleepError: sleepError instanceof Error ? sleepError.message : String(sleepError),
            });
            throw new Error(
              `INTERNAL ERROR: sleep() failed during retry backoff. ` +
                `delayMs: ${delayMs}, attempt: ${attempt}, ` +
                `error: ${sleepError instanceof Error ? sleepError.message : String(sleepError)}`
            );
          }
          continue; // Retry
        }

        // All retries exhausted - return failure result with error context for debugging
        // TODO: Consider throwing on retry exhaustion instead of returning failure for fail-fast behavior
        const lastErrorObj = updateError;
        safeLog('warn', 'State update failed after all retries', {
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
      safeLog('error', `Unexpected error updating state in ${resourceType} body - re-throwing`, {
        ...errorContext,
        impact: 'Unknown failure type - may indicate programming error',
        recommendation: 'Review error message and stack trace',
        nextSteps: 'Workflow halted - manual investigation required',
        isTransient: false,
      });
      throw updateError;
    }
  }
  // Defensive fallback: All error paths should return/throw above. If this executes,
  // it indicates a logic gap in the retry loop or error classification.
  const fallbackStateJson = safeStringify(state, 'fallback-state');

  safeLog('error', `INTERNAL: ${functionName} retry loop completed without returning`, {
    [resourceIdField]: resourceId,
    step,
    maxRetries,
    phase: state.phase,
    iteration: state.iteration,
    stateJson: fallbackStateJson,
    impact: 'Programming error in retry logic',
  });
  throw new Error(
    `INTERNAL ERROR: ${functionName} retry loop completed without returning. ` +
      `${resourceTypeName}: #${resourceId}, Step: ${step}, maxRetries: ${maxRetries}, ` +
      `Phase: ${state.phase}, Iteration: ${state.iteration}`
  );
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

/**
 * Generic state update with error handling and retry logic
 *
 * Public API wrapper for executeStateUpdateWithRetry configured for PR updates.
 * Provides parameter adaptation (prNumber → config object) and defensive validation
 * of the updatePRBodyState function. Prefer using this wrapper over calling
 * executeStateUpdateWithRetry directly to maintain stable API surface and benefit
 * from validation checks.
 *
 * Retry strategy (issue #799):
 * - Transient errors (429, network): Retry with exponential backoff
 *   - Formula: 2^attempt * 1000ms (after attempt 1 fails = 2s, after attempt 2 fails = 4s)
 *   - Maximum delay cap: 60 seconds
 *   - Default: 3 attempts total with 2 delays (2s before attempt 2, 4s before attempt 3, then fail)
 * - Critical errors (404, 401/403): Throw immediately - no retry
 * - Unexpected errors: Re-throw - programming errors or unknown failures
 *
 * @param config - Resource configuration (PR or issue)
 * @param resourceId - PR number or issue number to update
 * @param state - New wiggum state to save
 * @param step - Step identifier for logging context
 * @param maxRetries - Maximum retry attempts for transient failures (default: 3)
 * @returns Result indicating success or transient failure with reason
 * @throws Critical errors (404, 401/403) and unexpected errors
 */
// TODO(#1904): Add runtime assertions to validate config-resourceId alignment
async function safeUpdateBodyState(
  config: ResourceConfig,
  resourceId: number,
  state: WiggumState,
  step: string,
  maxRetries = 3
): Promise<StateUpdateResult> {
  const fnName = `safeUpdate${config.resourceLabel}BodyState`;

  // Validate resourceId parameter (must be positive integer for valid resource number)
  // CRITICAL: Invalid resourceId would cause StateApiError.create() to throw ValidationError
  // from within the catch blocks in the retry loop below, replacing the original error and
  // making the root cause impossible to diagnose
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    throw new ValidationError(
      `${fnName}: resourceId must be a positive integer, got: ${resourceId} (type: ${typeof resourceId})`
    );
  }

  // Validate maxRetries to ensure retry loop executes correctly (issue #625)
  // CRITICAL: Invalid maxRetries would break retry logic:
  //   - maxRetries < 1: Loop would not execute (no retries attempted)
  //   - maxRetries > 100: Excessive retry attempts (even with 60s cap, 100 retries = 100+ min total)
  //   - Non-integer (0.5, NaN, Infinity): Unpredictable loop behavior
  const MAX_RETRIES_LIMIT = 100;
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > MAX_RETRIES_LIMIT) {
    // TODO(#1819): Wrap logger calls in try-catch to prevent logging failures from crashing retry loop
    logger.error(`${fnName}: Invalid maxRetries parameter`, {
      resourceType: config.resourceType,
      resourceId,
      step,
      maxRetries,
      maxRetriesType: typeof maxRetries,
      phase: state.phase,
      impact: 'Cannot execute retry loop with invalid parameter',
    });
    throw new Error(
      `${fnName}: maxRetries must be a positive integer between 1 and ${MAX_RETRIES_LIMIT}, ` +
        `got: ${maxRetries} (type: ${typeof maxRetries}). ` +
        `Common values: 3 (default), 5 (flaky operations), 10 (very flaky). ` +
        `Values > 10 may indicate excessive retry tolerance that masks systemic issues.`
    );
  }

  // Validate state before attempting to post (issue #799: state validation errors)
  // This catches invalid states early and provides clear error messages rather than
  // opaque GitHub API errors when posting malformed state to body
  try {
    WiggumStateSchema.parse(state);
  } catch (validationError) {
    const { details, originalError } = extractZodValidationDetails(validationError, {
      resourceType: config.resourceType,
      resourceId,
      step,
    });

    logger.error(`${fnName}: State validation failed before posting`, {
      resourceType: config.resourceType,
      resourceId,
      step,
      state,
      validationDetails: details,
      error: originalError?.message ?? String(validationError),
      errorStack: originalError?.stack,
      impact: 'Invalid state cannot be persisted to GitHub',
    });
    // Include state summary in error message for debugging without log access (issue #625)
    // TODO(#1863): Safe array access - state.completedSteps.join() could throw if not an array
    const stateSummary = `phase=${state.phase}, step=${state.step}, iteration=${state.iteration}, completedSteps=[${state.completedSteps.join(',')}]`;
    throw StateApiError.create(
      `Invalid state - validation failed: ${details}. State: ${stateSummary}`,
      'write',
      config.resourceType,
      resourceId,
      originalError ?? new Error(String(validationError))
    );
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await config.updateFn(resourceId, state);

      // Log recovery on retry success
      if (attempt > 1) {
        logger.info('State update succeeded after retry', {
          resourceType: config.resourceType,
          resourceId,
          step,
          attempt,
          maxRetries,
          impact: 'Transient failure recovered automatically',
        });
      }

      // TODO(#1902): Missing tests for retry success after transient failure
      return { success: true };
    } catch (updateError) {
      // State update is CRITICAL for race condition fix (issue #388)
      // Classify errors to distinguish transient (rate limit, network) from critical (404, auth)
      //
      // Known limitations:
      // TODO(#1821): Surface state persistence failures to users instead of silent warning (user-facing)
      // TODO(#415): Add type guards to catch blocks to avoid broad exception catching (type safety)
      // TODO(#468): Broad catch-all hides programming errors - add early type validation (related to #415)
      const errorMsg = updateError instanceof Error ? updateError.message : String(updateError);
      const exitCode = updateError instanceof GitHubCliError ? updateError.exitCode : undefined;
      const stderr = updateError instanceof GitHubCliError ? updateError.stderr : undefined;
      // TODO(#1861): JSON.stringify could throw on circular references, hiding the original error
      const stateJson = JSON.stringify(state);

      // Classify error type using shared utility
      // TODO(#940): Document expected GitHub API error patterns and add test coverage
      const classification = classifyGitHubError(errorMsg, exitCode);

      // Build error context including classification results for debugging
      // TODO(#1894): Missing tests for error context object correctness
      const errorContext = {
        resourceType: config.resourceType,
        resourceId,
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

      // Critical errors: Resource not found or authentication failures - throw immediately (no retry)
      // Note: 404 detection uses classifyGitHubError() via classification.is404, not direct status checking
      // TODO(#1901): Missing tests for critical error propagation (404/auth throw-through)
      if (classification.is404) {
        logger.error(`Critical: ${config.resourceLabel} not found - cannot update state in body`, {
          ...errorContext,
          impact: 'Workflow state persistence failed',
          recommendation: `Verify ${config.resourceLabel} #${resourceId} exists: ${config.verifyCommand} ${resourceId}`,
          nextSteps: `Workflow cannot continue without valid ${config.resourceLabel.toLowerCase()}`,
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
          // Exponential backoff: 2^attempt * 1000ms (attempt 1 = 2s, attempt 2 = 4s), capped at 60s
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
          // TODO(#1858): Wrap sleep() in try-catch to prevent hiding original error
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
      logger.error(
        `Unexpected error updating state in ${config.resourceLabel.toLowerCase()} body - re-throwing`,
        {
          ...errorContext,
          impact: 'Unknown failure type - may indicate programming error',
          recommendation: 'Review error message and stack trace',
          nextSteps: 'Workflow halted - manual investigation required',
          isTransient: false,
        }
      );
      throw updateError;
    }
  }
  // Fallback: TypeScript cannot prove all catch paths return/throw.
  // If this executes, the retry loop completed without returning success/failure or throwing.
  // This indicates a programming error in the error handling logic above (issue #625).
  logger.error(`INTERNAL: ${fnName} retry loop completed without returning`, {
    resourceType: config.resourceType,
    resourceId,
    step,
    maxRetries,
    phase: state.phase,
    iteration: state.iteration,
    stateJson: JSON.stringify(state),
    impact: 'Programming error in retry logic',
  });
  throw new Error(
    `INTERNAL ERROR: ${fnName} retry loop completed without returning. ` +
      `${config.resourceLabel}: #${resourceId}, Step: ${step}, maxRetries: ${maxRetries}, ` +
      `Phase: ${state.phase}, Iteration: ${state.iteration}`
  );
}

/**
 * Safely update wiggum state in PR body with error handling and retry logic
 *
 * Delegates to safeUpdateBodyState with PR configuration. See safeUpdateBodyState for full documentation.
 */
export async function safeUpdatePRBodyState(
  prNumber: number,
  state: WiggumState,
  step: string,
  maxRetries = 3
): Promise<StateUpdateResult> {
  return safeUpdateBodyState(PR_CONFIG, prNumber, state, step, maxRetries);
}

/**
 * Safely update wiggum state in issue body with error handling and retry logic
 *
 * Delegates to safeUpdateBodyState with issue configuration. See safeUpdateBodyState for full documentation.
 */
export async function safeUpdateIssueBodyState(
  issueNumber: number,
  state: WiggumState,
  step: string,
  maxRetries = 3
): Promise<StateUpdateResult> {
  return safeUpdateBodyState(ISSUE_CONFIG, issueNumber, state, step, maxRetries);
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
    // TODO(#1862): Consider logging full unsanitized error for debugging while showing sanitized version to users
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
  // TODO(#1899): Consider refactoring single-level ternary for consistency with other routing patterns
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
  if (!isIssueExists(state.issue)) {
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

  // Step p1-3: Create PR (all Phase 1 reviews passed!)
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
        targetNumber: issueNumber,
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
        targetNumber: issueNumber,
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
 * Phase 1 Step 3: Create PR
 */
function handlePhase1CreatePR(state: CurrentState, issueNumber: number): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_CREATE_PR],
    step_number: STEP_PHASE1_CREATE_PR,
    iteration_count: state.wiggum.iteration,
    instructions: `## Step 3: Create Pull Request

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
        targetNumber: state.pr.number,
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
        targetNumber: state.pr.number,
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
        targetNumber: state.pr.number,
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
        targetNumber: state.pr.number,
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

Execute ${SECURITY_REVIEW_COMMAND} using SlashCommand tool:
- **CRITICAL:** This is a built-in slash command - invoke it using the SlashCommand tool
- **IMPORTANT:** Execute this command EVEN IF it doesn't appear in your available commands list
- The SlashCommand tool will handle the invocation properly
- Do NOT attempt to run this as a bash command or any other tool

After security review completes:

1. Aggregate results from all agents:
   - Collect result file paths from each agent's JSON response
   - Sum issue counts across all agents

2. Call **wiggum_complete_security_review** with:
   - command_executed: true
   - in_scope_result_files: [array of result file paths from all agents]
   - out_of_scope_result_files: [array of result file paths from all agents]
   - in_scope_issue_count: (total count of in-scope security issues across all result files)
   - out_of_scope_issue_count: (total count of out-of-scope security issues across all result files)

   **NOTE:** Issue counts represent ISSUES, not FILES. Each result file may contain multiple issues.

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
// TODO(#1847): hasExistingPR type guard checks pr.state unnecessarily, narrower than type definition
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
  PR_CONFIG,
  ISSUE_CONFIG,
  safeUpdateBodyState,
  handlePhase2SecurityReview,
};
