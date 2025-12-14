/**
 * PR comment state management for Wiggum flow
 */

import { getPRComments, postPRComment } from '../utils/gh-cli.js';
import {
  WIGGUM_STATE_MARKER,
  WIGGUM_COMMENT_PREFIX,
  isValidStep,
  STEP_ENSURE_PR,
} from '../constants.js';
import { logger } from '../utils/logger.js';
import type { WiggumState } from './types.js';
import type { WiggumStep } from '../constants.js';

// Module-level validation: Ensure STEP_ENSURE_PR is a valid step at import time
// This acts as a compile-time guard to catch inconsistencies in constants.ts
// If STEP_ENSURE_PR is used as the default step in validateWiggumState, it must be valid
// Throwing at module initialization ensures the error is caught immediately on server start
// rather than during runtime when invalid state is encountered
if (!isValidStep(STEP_ENSURE_PR)) {
  throw new Error(
    `CRITICAL: STEP_ENSURE_PR constant "${STEP_ENSURE_PR}" is not a valid step. ` +
      `This indicates the step enum was changed without updating STEP_ENSURE_PR. ` +
      `Check constants.ts for consistency.`
  );
}

/**
 * Validate and sanitize wiggum state from untrusted JSON
 */
function validateWiggumState(data: unknown): WiggumState {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid state: not an object');
  }

  const obj = data as Record<string, unknown>;

  const iteration = typeof obj.iteration === 'number' ? obj.iteration : 0;
  let step: WiggumStep;
  if (isValidStep(obj.step)) {
    step = obj.step;
  } else {
    // STEP_ENSURE_PR validity is guaranteed by module-level validation at import time
    logger.warn('validateWiggumState: invalid step value, defaulting to initial step', {
      invalidStep: obj.step,
      defaultingTo: STEP_ENSURE_PR,
    });
    step = STEP_ENSURE_PR;
  }
  const completedSteps = Array.isArray(obj.completedSteps)
    ? obj.completedSteps.filter(isValidStep)
    : [];

  return { iteration, step, completedSteps };
}

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
        const raw = JSON.parse(match[1]);
        return validateWiggumState(raw);
      } catch (error) {
        logger.warn('getWiggumState: failed to parse state JSON from comment', {
          commentId: comment.id,
          error: error instanceof Error ? error.message : String(error),
          rawJson: match[1].substring(0, 200),
        });
        continue;
      }
    }
  }

  // No state found, return initial state
  return {
    iteration: 0,
    step: '0',
    completedSteps: [],
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
