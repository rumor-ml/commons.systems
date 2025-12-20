/**
 * GitHub issue comment state management for Wiggum flow
 * Mirrors PR comment functionality but operates on GitHub issues
 */

// TODO(#287): Implement comprehensive tests for Phase 1 workflow
// Currently 43% of tests are placeholders. See issue for specific test requirements.
import { ghCli, ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import {
  WIGGUM_STATE_MARKER,
  WIGGUM_COMMENT_PREFIX,
  STEP_PHASE1_MONITOR_WORKFLOW,
} from '../constants.js';
import { logger } from '../utils/logger.js';
import { safeJsonParse, validateWiggumState } from './utils.js';
import type { WiggumState } from './types.js';

/**
 * GitHub issue comment type
 */
export interface GitHubIssueComment {
  author: string;
  body: string;
  createdAt: string;
  id: string;
}

/**
 * Get all comments for a GitHub issue
 *
 * Fetches all comments on an issue using gh CLI.
 * Returns simplified comment objects with author, body, timestamp, and ID.
 *
 * @param issueNumber - Issue number to fetch comments for
 * @param repo - Optional repository in "owner/repo" format
 * @returns Array of issue comments with author, body, createdAt, and id
 * @throws {GitHubCliError} When issue doesn't exist or gh command fails
 *
 * @example
 * ```typescript
 * const comments = await getIssueComments(123, "owner/repo");
 * for (const comment of comments) {
 *   console.log(`${comment.author}: ${comment.body}`);
 * }
 * ```
 */
export async function getIssueComments(
  issueNumber: number,
  repo?: string
): Promise<GitHubIssueComment[]> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson<GitHubIssueComment[]>(
    [
      'api',
      `repos/${resolvedRepo}/issues/${issueNumber}/comments`,
      '--jq',
      'map({author: .user.login, body: .body, createdAt: .created_at, id: (.id | tostring)})',
    ],
    {}
  );
}

/**
 * Post a comment to a GitHub issue
 *
 * Posts a new comment on an issue using gh CLI.
 *
 * @param issueNumber - Issue number to comment on
 * @param body - Comment body (markdown supported)
 * @param repo - Optional repository in "owner/repo" format
 * @throws {GitHubCliError} When issue doesn't exist or gh command fails
 *
 * @example
 * ```typescript
 * await postIssueComment(123, "Starting work on this issue", "owner/repo");
 * ```
 */
export async function postIssueComment(
  issueNumber: number,
  body: string,
  repo?: string
): Promise<void> {
  const resolvedRepo = await resolveRepo(repo);
  await ghCli(['issue', 'comment', issueNumber.toString(), '--body', body], { repo: resolvedRepo });
}

/**
 * Parse wiggum state from issue comments
 * Looks for comments with <!-- wiggum-state:{...} --> marker
 */
export async function getWiggumStateFromIssue(
  issueNumber: number,
  repo?: string
): Promise<WiggumState> {
  const comments = await getIssueComments(issueNumber, repo);

  // Find most recent wiggum state comment
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    const match = comment.body.match(
      new RegExp(`<!--\\s*${WIGGUM_STATE_MARKER}:(.+?)\\s*-->`, 's')
    );

    if (match) {
      try {
        const raw = safeJsonParse(match[1]);
        return validateWiggumState(raw, 'issue comment');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // TODO(#272): Add security alerting for prototype pollution detection
        // Current: logs at ERROR but no notification/alert (see PR review #273)
        // Log prototype pollution attempts at ERROR level for security monitoring
        const logLevel = errorMsg.includes('Prototype pollution') ? 'error' : 'warn';
        // TODO(#299): Replace dynamic logger method selection with explicit if/else for clarity
        logger[logLevel]('getWiggumStateFromIssue: failed to parse state JSON from comment', {
          commentId: comment.id,
          error: errorMsg,
          rawJson: match[1].substring(0, 200),
          isPotentialAttack: errorMsg.includes('Prototype pollution'),
        });
        continue;
      }
    }
  }

  // No state found, return initial state (Phase 1, Step 1)
  return {
    iteration: 0,
    step: STEP_PHASE1_MONITOR_WORKFLOW,
    completedSteps: [],
    phase: 'phase1',
  };
}

/**
 * Post a new wiggum state comment to issue
 */
export async function postWiggumStateIssueComment(
  issueNumber: number,
  state: WiggumState,
  title: string,
  body: string,
  repo?: string
): Promise<void> {
  const stateJson = JSON.stringify(state);
  const comment = `<!-- ${WIGGUM_STATE_MARKER}:${stateJson} -->
${WIGGUM_COMMENT_PREFIX} ${title}

${body}

---
*Automated via Wiggum*`;

  await postIssueComment(issueNumber, comment, repo);
}

/**
 * Check if a specific review command was executed (evidence in issue comments)
 */
export async function hasIssueReviewCommandEvidence(
  issueNumber: number,
  command: string,
  repo?: string
): Promise<boolean> {
  const comments = await getIssueComments(issueNumber, repo);

  logger.debug('hasIssueReviewCommandEvidence: searching for command', {
    issueNumber,
    command,
    commentCount: comments.length,
  });

  // Search for command mention in any comment
  for (const comment of comments) {
    if (comment.body.includes(command)) {
      return true;
    }
  }

  logger.debug('hasIssueReviewCommandEvidence: command not found', {
    issueNumber,
    command,
    checkedCommentCount: comments.length,
  });

  return false;
}
