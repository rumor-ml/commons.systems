/**
 * PR comment utilities for Wiggum flow
 *
 * NOTE: State tracking has been moved to body-state.ts.
 * This module now only handles comment-based utilities like
 * review command evidence checking.
 */

import { getPRComments } from '../utils/gh-cli.js';
import { logger } from '../utils/logger.js';

/**
 * Check if a specific review command was executed (evidence in PR comments)
 */
export async function hasReviewCommandEvidence(
  prNumber: number,
  command: string,
  repo?: string
): Promise<boolean> {
  const comments = await getPRComments(prNumber, repo);

  logger.debug('hasReviewCommandEvidence: searching for command', {
    prNumber,
    command,
    commentCount: comments.length,
  });

  // Search for command mention in any comment
  for (const comment of comments) {
    if (comment.body.includes(command)) {
      return true;
    }
  }

  logger.debug('hasReviewCommandEvidence: command not found', {
    prNumber,
    command,
    checkedCommentCount: comments.length,
  });

  return false;
}
