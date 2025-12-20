/**
 * PR comment state management for Wiggum flow
 */

import { getPRComments, postPRComment } from '../utils/gh-cli.js';
import {
  WIGGUM_STATE_MARKER,
  WIGGUM_COMMENT_PREFIX,
  STEP_PHASE1_MONITOR_WORKFLOW,
} from '../constants.js';
import { logger } from '../utils/logger.js';
import { safeJsonParse, validateWiggumState } from './utils.js';
import type { WiggumState } from './types.js';

/**
 * Parse wiggum state from PR comments
 * Looks for comments with <!-- wiggum-state:{...} --> marker
 */
export async function getWiggumState(prNumber: number, repo?: string): Promise<WiggumState> {
  const comments = await getPRComments(prNumber, repo);

  // Find most recent wiggum state comment
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    const match = comment.body.match(
      new RegExp(`<!--\\s*${WIGGUM_STATE_MARKER}:(.+?)\\s*-->`, 's')
    );

    if (match) {
      try {
        const raw = safeJsonParse(match[1]);
        return validateWiggumState(raw, 'PR comment');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Log prototype pollution attempts at ERROR level for security monitoring
        const logLevel = errorMsg.includes('Prototype pollution') ? 'error' : 'warn';
        logger[logLevel]('getWiggumState: failed to parse state JSON from comment', {
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
 * Post a new wiggum state comment to PR
 */
export async function postWiggumStateComment(
  prNumber: number,
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

  await postPRComment(prNumber, comment, repo);
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
