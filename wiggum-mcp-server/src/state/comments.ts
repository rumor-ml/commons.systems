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
 * Search for command evidence in a list of comments
 *
 * @internal Pure function for testing - no I/O operations
 */
function searchCommandInComments(comments: readonly { body: string }[], command: string): boolean {
  for (const comment of comments) {
    if (comment.body.includes(command)) {
      return true;
    }
  }
  return false;
}

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

  const found = searchCommandInComments(comments, command);

  if (!found) {
    logger.debug('hasReviewCommandEvidence: command not found', {
      prNumber,
      command,
      checkedCommentCount: comments.length,
    });
  }

  return found;
}

/**
 * Test exports for unit testing internal functions
 * @internal Only use in tests
 */
export const _testExports = {
  searchCommandInComments,
};
