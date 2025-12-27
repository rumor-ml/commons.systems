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
 * Extract WiggumState from PR/issue body text
 *
 * Searches for wiggum-state HTML comment marker and parses JSON state.
 *
 * @param body - PR or issue description body text
 * @returns Parsed WiggumState if found, null if not found
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
    // CRITICAL: State parsing failure indicates corrupted state data, malformed JSON,
    // or serialization bugs. Logged at ERROR level for visibility. Returns null to
    // trigger state reset (callers will initialize new state, losing in-progress workflow).
    // TODO(#485): Consider throwing exception instead to force explicit error handling.
    logger.error('extractStateFromBody: critical state parsing failure', {
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      bodyLength: body.length,
      matchedJson: match[1].substring(0, 200), // Log first 200 chars for debugging
      impact: 'Workflow state will reset to defaults - user may lose progress',
    });
    return null;
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

    // Non-critical errors: network issues, transient API failures, etc.
    // Return null to indicate "no state found" - callers should handle this gracefully
    logger.warn('getWiggumStateFromPRBody: failed to fetch PR body - treating as no state', {
      prNumber,
      repo,
      error: errorMsg,
      exitCode,
      assumption: 'PR may have no wiggum state or transient error occurred',
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

    // Non-critical errors: network issues, transient API failures, etc.
    // Return null to indicate "no state found" - callers should handle this gracefully
    logger.warn('getWiggumStateFromIssueBody: failed to fetch issue body - treating as no state', {
      issueNumber,
      repo,
      error: errorMsg,
      exitCode,
      assumption: 'Issue may have no wiggum state or transient error occurred',
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
