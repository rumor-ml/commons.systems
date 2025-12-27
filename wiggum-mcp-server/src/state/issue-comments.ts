/**
 * GitHub issue comment utilities for Wiggum flow
 *
 * NOTE: State tracking has been moved to body-state.ts.
 * This module now only handles comment-based utilities like
 * review command evidence checking and general issue comment operations.
 */

// TODO(#302): Implement comprehensive tests for Phase 1 workflow
// Currently 43% of tests are placeholders. See issue for specific test requirements.
import { ghCli, ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import { logger } from '../utils/logger.js';

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
