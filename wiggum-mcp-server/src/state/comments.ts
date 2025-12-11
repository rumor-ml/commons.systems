/**
 * PR comment state management for Wiggum flow
 */

import { getPRComments, postPRComment } from '../utils/gh-cli.js';
import { WIGGUM_STATE_MARKER, WIGGUM_COMMENT_PREFIX } from '../constants.js';
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
        const state = JSON.parse(match[1]) as WiggumState;
        return {
          iteration: state.iteration || 0,
          step: state.step || '0',
          completedSteps: state.completedSteps || [],
        };
      } catch (error) {
        // Invalid JSON, continue searching
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

  // Search for command mention in any comment
  for (const comment of comments) {
    if (comment.body.includes(command)) {
      return true;
    }
  }

  return false;
}
