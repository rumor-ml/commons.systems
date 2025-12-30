/**
 * State persistence in PR/issue description bodies
 *
 * Stores WiggumState in PR/issue description bodies as HTML comments.
 * This provides a single source of truth that's more permanent than comment threads.
 */

import { ghCli } from '../utils/gh-cli.js';
import { logger } from '../utils/logger.js';
import { WIGGUM_STATE_MARKER } from '../constants.js';
import type { WiggumState } from './types.js';
import { validateWiggumState, safeJsonParse } from './utils.js';
import { GitHubCliError } from '../utils/errors.js';

/**
 * Error indicating invalid parameters when constructing StateCorruptionError
 *
 * This class is thrown when StateCorruptionError constructor receives invalid parameters.
 * Using a specific error class (instead of generic Error) makes error handling more predictable
 * and allows callers to distinguish validation failures from corruption errors.
 */
export class StateCorruptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateCorruptionValidationError';
  }
}

/**
 * Error thrown when workflow state cannot be parsed from PR/issue body
 *
 * This error indicates corrupted state data that requires user intervention.
 * The error message includes actionable recovery instructions.
 *
 * **Constructor validation:**
 * - bodyLength must be non-negative (throws StateCorruptionValidationError if negative)
 * - matchedJsonPreview must not exceed 200 chars (throws StateCorruptionValidationError if exceeds)
 *
 * **When to use constructor vs factory:**
 * - Use constructor when parameters are already validated or from trusted source
 * - Use StateCorruptionError.create() factory when parameters need validation with explicit error handling
 *
 * @throws {StateCorruptionValidationError} If bodyLength is negative or matchedJsonPreview exceeds 200 chars
 */
export class StateCorruptionError extends Error {
  constructor(
    message: string,
    public readonly originalError: string,
    public readonly bodyLength: number,
    public readonly matchedJsonPreview: string
  ) {
    // Validate constructor parameters for fail-fast behavior
    // Throws StateCorruptionValidationError (not generic Error) for predictable error handling
    if (bodyLength < 0) {
      throw new StateCorruptionValidationError(
        'StateCorruptionError: bodyLength cannot be negative'
      );
    }
    if (matchedJsonPreview.length > 200) {
      throw new StateCorruptionValidationError(
        'StateCorruptionError: matchedJsonPreview exceeds 200 char limit'
      );
    }
    super(message);
    this.name = 'StateCorruptionError';
  }

  /**
   * Factory function to create StateCorruptionError with validation
   *
   * Returns either a StateCorruptionError on success or StateCorruptionValidationError if
   * parameters are invalid. This avoids throwing from the constructor, making error
   * construction more predictable for callers who want explicit error handling.
   *
   * @param message - Human-readable error description with recovery instructions
   * @param originalError - Original error message that caused state parsing to fail
   * @param bodyLength - Length of the PR/issue body (must be non-negative)
   * @param matchedJsonPreview - Preview of matched JSON (will be truncated to 200 chars)
   * @returns StateCorruptionError if valid, StateCorruptionValidationError if parameters invalid
   */
  static create(
    message: string,
    originalError: string,
    bodyLength: number,
    matchedJsonPreview: string
  ): StateCorruptionError | StateCorruptionValidationError {
    if (bodyLength < 0) {
      return new StateCorruptionValidationError(
        'StateCorruptionError: bodyLength cannot be negative'
      );
    }
    // Truncate matchedJsonPreview if needed (permissive approach for factory)
    const truncatedPreview =
      matchedJsonPreview.length > 200 ? matchedJsonPreview.substring(0, 200) : matchedJsonPreview;
    return new StateCorruptionError(message, originalError, bodyLength, truncatedPreview);
  }
}

/**
 * Extract WiggumState from PR/issue body text
 *
 * Searches for wiggum-state HTML comment marker and parses JSON state.
 *
 * @param body - PR or issue description body text
 * @returns Parsed WiggumState if found, null if no state marker found
 * @throws {StateCorruptionError} When state marker exists but JSON is malformed/invalid
 */
function extractStateFromBody(body: string): WiggumState | null {
  if (!body) {
    return null;
  }

  // Match HTML comment with wiggum-state marker
  // Pattern: <!-- wiggum-state:{"iteration":0,...} -->
  const regex = new RegExp(`<!--\\s*${WIGGUM_STATE_MARKER}:(.+?)\\s*-->`, 's');
  const match = body.match(regex);

  if (!match || !match[1]) {
    return null;
  }

  try {
    const raw = safeJsonParse(match[1]);
    return validateWiggumState(raw, 'PR/issue body');
  } catch (error) {
    // CRITICAL: State parsing failure indicates corrupted state data.
    // Throwing here forces callers to handle the error explicitly and inform the user.
    const errorMsg = error instanceof Error ? error.message : String(error);
    const matchedJsonPreview = match[1].substring(0, 200);

    // Defensive validation: clamp bodyLength to non-negative to avoid throwing
    // StateCorruptionValidationError during error construction. This should never
    // happen (body.length is always >= 0 for strings), but we clamp defensively
    // to ensure the state corruption error is always thrown, not masked by
    // a validation error about negative bodyLength.
    const safeBodyLength = Math.max(0, body.length);
    if (body.length < 0) {
      // Log if we ever hit this impossible case - would indicate a serious bug
      logger.warn('extractStateFromBody: body.length is negative - clamping to 0', {
        bodyLength: body.length,
        impact: 'Internal error - body should never have negative length',
      });
    }

    logger.error('extractStateFromBody: critical state parsing failure', {
      error: errorMsg,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      bodyLength: safeBodyLength,
      matchedJson: matchedJsonPreview,
      impact: 'Workflow state is corrupted and cannot be parsed',
    });

    // Throw with actionable error message for user
    throw new StateCorruptionError(
      `Wiggum workflow state is corrupted and cannot be parsed.\n\n` +
        `Error: ${errorMsg}\n\n` +
        `The state data in the PR/issue body is malformed. This may be due to:\n` +
        `  1. Manual editing of the PR/issue body that broke the JSON\n` +
        `  2. Concurrent state updates causing corruption\n` +
        `  3. A bug in the state serialization logic\n\n` +
        `Action required:\n` +
        `  1. View the PR/issue body and locate the HTML comment with 'wiggum-state:'\n` +
        `  2. Either fix the JSON manually or remove the comment to reset the workflow\n` +
        `  3. If corruption persists, file a bug with the error details above`,
      errorMsg,
      safeBodyLength,
      matchedJsonPreview
    );
  }
}

/**
 * Inject or replace WiggumState in PR/issue body text
 *
 * Adds wiggum-state HTML comment marker to body. If marker already exists,
 * replaces it with new state. Otherwise prepends marker to body.
 *
 * @param body - Original PR or issue description body text
 * @param state - WiggumState to inject
 * @returns Updated body text with state marker
 */
function injectStateIntoBody(body: string, state: WiggumState): string {
  const stateJson = JSON.stringify(state);
  const stateMarker = `<!-- ${WIGGUM_STATE_MARKER}:${stateJson} -->`;

  // Check if state marker already exists
  const regex = new RegExp(`<!--\\s*${WIGGUM_STATE_MARKER}:.+?\\s*-->`, 's');

  if (regex.test(body)) {
    // Replace existing marker
    return body.replace(regex, stateMarker);
  } else {
    // Prepend marker to body
    return `${stateMarker}\n\n${body}`;
  }
}

/**
 * Get WiggumState from PR description body
 *
 * Fetches PR body via gh CLI and extracts wiggum-state marker.
 *
 * @param prNumber - PR number to fetch
 * @param repo - Optional repository in "owner/repo" format
 * @returns WiggumState if found, null if not found or error
 */
export async function getWiggumStateFromPRBody(
  prNumber: number,
  repo?: string
): Promise<WiggumState | null> {
  try {
    const args = ['pr', 'view', prNumber.toString(), '--json', 'body', '-q', '.body'];
    const options = repo ? { repo } : {};
    const body = await ghCli(args, options);

    return extractStateFromBody(body);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const exitCode = error instanceof GitHubCliError ? error.exitCode : undefined;

    // StateCorruptionError: Log with PR context before re-throwing
    // This error indicates corrupted state data that requires user intervention
    if (error instanceof StateCorruptionError) {
      logger.error('getWiggumStateFromPRBody: state corruption detected in PR body', {
        prNumber,
        repo,
        error: errorMsg,
        originalError: error.originalError,
        bodyLength: error.bodyLength,
        matchedJsonPreview: error.matchedJsonPreview,
        impact: 'Workflow state is corrupted and cannot be parsed',
        action: 'User must manually fix or remove state marker in PR body',
      });
      throw error;
    }

    // Critical errors should propagate - these indicate problems that won't self-resolve:
    // - 401: Authentication required (user's gh CLI session may have expired)
    // - 403: Access denied (user doesn't have permission to view this PR)
    // - 404: PR not found (typo in PR number, PR was deleted, or wrong repo)
    if (exitCode === 401 || exitCode === 403 || exitCode === 404) {
      logger.error('getWiggumStateFromPRBody: critical error fetching PR body - propagating', {
        prNumber,
        repo,
        exitCode,
        error: errorMsg,
        impact: 'Cannot proceed without valid PR access',
      });
      throw error;
    }

    // Non-critical errors: network issues, transient API failures, rate limits, etc.
    // Return null to indicate "no state found" - callers should handle this gracefully.
    //
    // RATIONALE for null fallback (why this is acceptable):
    //   1. Callers treat missing state as "initialize new workflow" - safe default
    //   2. Transient errors (network, rate limit, server 5xx) will resolve on retry
    //   3. State persistence uses read-back verification to detect write failures
    //   4. Users can always manually check PR body to verify state presence
    //
    // TRADE-OFF: Caller cannot distinguish "no state exists" from "fetch failed".
    // This is logged at ERROR level to ensure visibility for debugging.
    logger.error('getWiggumStateFromPRBody: failed to fetch PR body - returning null', {
      prNumber,
      repo,
      error: errorMsg,
      exitCode,
      impact: 'Caller will treat this as "no state exists" - may reinitialize workflow',
      action: 'Retry the operation or check GitHub API status if issue persists',
      assumption: 'Transient error will resolve on retry',
    });
    return null;
  }
}

/**
 * Get WiggumState from issue description body
 *
 * Fetches issue body via gh CLI and extracts wiggum-state marker.
 *
 * @param issueNumber - Issue number to fetch
 * @param repo - Optional repository in "owner/repo" format
 * @returns WiggumState if found, null if not found or error
 */
export async function getWiggumStateFromIssueBody(
  issueNumber: number,
  repo?: string
): Promise<WiggumState | null> {
  try {
    const args = ['issue', 'view', issueNumber.toString(), '--json', 'body', '-q', '.body'];
    const options = repo ? { repo } : {};
    const body = await ghCli(args, options);

    return extractStateFromBody(body);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const exitCode = error instanceof GitHubCliError ? error.exitCode : undefined;

    // StateCorruptionError: Log with issue context before re-throwing
    // This error indicates corrupted state data that requires user intervention
    if (error instanceof StateCorruptionError) {
      logger.error('getWiggumStateFromIssueBody: state corruption detected in issue body', {
        issueNumber,
        repo,
        error: errorMsg,
        originalError: error.originalError,
        bodyLength: error.bodyLength,
        matchedJsonPreview: error.matchedJsonPreview,
        impact: 'Workflow state is corrupted and cannot be parsed',
        action: 'User must manually fix or remove state marker in issue body',
      });
      throw error;
    }

    // Critical errors should propagate - these indicate problems that won't self-resolve:
    // - 401: Authentication required (user's gh CLI session may have expired)
    // - 403: Access denied (user doesn't have permission to view this issue)
    // - 404: Issue not found (typo in issue number, issue was deleted, or wrong repo)
    if (exitCode === 401 || exitCode === 403 || exitCode === 404) {
      logger.error(
        'getWiggumStateFromIssueBody: critical error fetching issue body - propagating',
        {
          issueNumber,
          repo,
          exitCode,
          error: errorMsg,
          impact: 'Cannot proceed without valid issue access',
        }
      );
      throw error;
    }

    // Non-critical errors: network issues, transient API failures, rate limits, etc.
    // Return null to indicate "no state found" - callers should handle this gracefully.
    //
    // RATIONALE for null fallback (why this is acceptable):
    //   1. Callers treat missing state as "initialize new workflow" - safe default
    //   2. Transient errors (network, rate limit, server 5xx) will resolve on retry
    //   3. State persistence uses read-back verification to detect write failures
    //   4. Users can always manually check issue body to verify state presence
    //
    // TRADE-OFF: Caller cannot distinguish "no state exists" from "fetch failed".
    // This is logged at ERROR level to ensure visibility for debugging.
    logger.error('getWiggumStateFromIssueBody: failed to fetch issue body - returning null', {
      issueNumber,
      repo,
      error: errorMsg,
      exitCode,
      impact: 'Caller will treat this as "no state exists" - may reinitialize workflow',
      action: 'Retry the operation or check GitHub API status if issue persists',
      assumption: 'Transient error will resolve on retry',
    });
    return null;
  }
}

/**
 * Update PR description body with new WiggumState
 *
 * Fetches current PR body, injects/replaces state marker, and updates via gh CLI.
 * Uses read-modify-write pattern to preserve user content.
 *
 * IMPORTANT: Caller is responsible for error handling. This function throws on failures.
 *
 * @param prNumber - PR number to update
 * @param state - New WiggumState to persist
 * @param repo - Optional repository in "owner/repo" format
 * @throws {Error} When gh CLI commands fail
 */
export async function updatePRBodyState(
  prNumber: number,
  state: WiggumState,
  repo?: string
): Promise<void> {
  // Read current body
  const viewArgs = ['pr', 'view', prNumber.toString(), '--json', 'body', '-q', '.body'];
  const viewOptions = repo ? { repo } : {};
  const currentBody = await ghCli(viewArgs, viewOptions);

  // Inject/replace state marker
  const updatedBody = injectStateIntoBody(currentBody, state);

  // Write updated body
  // NOTE: ghCli runs gh commands via subprocess. When Claude Code agents
  // call gh commands directly via Bash tool, they must use
  // dangerouslyDisableSandbox: true per CLAUDE.md.
  const editArgs = ['pr', 'edit', prNumber.toString(), '--body', updatedBody];
  const editOptions = repo ? { repo } : {};

  await ghCli(editArgs, editOptions);

  logger.info('updatePRBodyState: successfully updated PR body state', {
    prNumber,
    repo,
    iteration: state.iteration,
    step: state.step,
    phase: state.phase,
    maxIterations: state.maxIterations,
  });
}

/**
 * Update issue description body with new WiggumState
 *
 * Fetches current issue body, injects/replaces state marker, and updates via gh CLI.
 * Uses read-modify-write pattern to preserve user content.
 *
 * IMPORTANT: Caller is responsible for error handling. This function throws on failures.
 *
 * @param issueNumber - Issue number to update
 * @param state - New WiggumState to persist
 * @param repo - Optional repository in "owner/repo" format
 * @throws {Error} When gh CLI commands fail
 */
export async function updateIssueBodyState(
  issueNumber: number,
  state: WiggumState,
  repo?: string
): Promise<void> {
  // Read current body
  const viewArgs = ['issue', 'view', issueNumber.toString(), '--json', 'body', '-q', '.body'];
  const viewOptions = repo ? { repo } : {};
  const currentBody = await ghCli(viewArgs, viewOptions);

  // Inject/replace state marker
  const updatedBody = injectStateIntoBody(currentBody, state);

  // Write updated body
  // NOTE: ghCli runs gh commands via subprocess. When Claude Code agents
  // call gh commands directly via Bash tool, they must use
  // dangerouslyDisableSandbox: true per CLAUDE.md.
  const editArgs = ['issue', 'edit', issueNumber.toString(), '--body', updatedBody];
  const editOptions = repo ? { repo } : {};

  await ghCli(editArgs, editOptions);

  logger.info('updateIssueBodyState: successfully updated issue body state', {
    issueNumber,
    repo,
    iteration: state.iteration,
    step: state.step,
    phase: state.phase,
    maxIterations: state.maxIterations,
  });
}

/**
 * Export helper functions for testing
 * @internal
 */
export const _testExports = {
  extractStateFromBody,
  injectStateIntoBody,
};
