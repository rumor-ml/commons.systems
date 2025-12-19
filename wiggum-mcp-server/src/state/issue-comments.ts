/**
 * GitHub issue comment state management for Wiggum flow
 * Mirrors PR comment functionality but operates on GitHub issues
 */

import { ghCli, ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import {
  WIGGUM_STATE_MARKER,
  WIGGUM_COMMENT_PREFIX,
  isValidStep,
  STEP_PHASE1_MONITOR_WORKFLOW,
} from '../constants.js';
import { logger } from '../utils/logger.js';
import type { WiggumState } from './types.js';
import type { WiggumStep } from '../constants.js';

// Module-level validation: Ensure STEP_PHASE1_MONITOR_WORKFLOW is a valid step at import time
// This acts as a compile-time guard to catch inconsistencies in constants.ts
// If STEP_PHASE1_MONITOR_WORKFLOW is used as the default step in validateWiggumState, it must be valid
// Throwing at module initialization ensures the error is caught immediately on server start
// rather than during runtime when invalid state is encountered
if (!isValidStep(STEP_PHASE1_MONITOR_WORKFLOW)) {
  throw new Error(
    `CRITICAL: STEP_PHASE1_MONITOR_WORKFLOW constant "${STEP_PHASE1_MONITOR_WORKFLOW}" is not a valid step. ` +
      `This indicates the step enum was changed without updating STEP_PHASE1_MONITOR_WORKFLOW. ` +
      `Check constants.ts for consistency.`
  );
}

/**
 * Check for prototype pollution in parsed JSON object
 *
 * Recursively checks for dangerous property names that can be used for
 * prototype pollution attacks: __proto__, constructor, prototype.
 *
 * @param obj - Object to check for prototype pollution
 * @param depth - Current recursion depth (max 10 levels)
 * @returns true if pollution detected, false otherwise
 */
function hasPrototypePollution(obj: unknown, depth: number = 0): boolean {
  // Limit recursion depth to prevent stack overflow
  if (depth > 10) return false;

  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const keys = Object.keys(obj);
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

  // Check for dangerous keys at this level
  for (const key of keys) {
    if (dangerousKeys.includes(key)) {
      return true;
    }

    // Recursively check nested objects
    const value = (obj as Record<string, unknown>)[key];
    if (hasPrototypePollution(value, depth + 1)) {
      return true;
    }
  }

  return false;
}

/**
 * Safely parse JSON with prototype pollution detection
 *
 * Wraps JSON.parse with validation to detect and reject objects
 * containing dangerous properties that could lead to prototype pollution.
 *
 * @param json - JSON string to parse
 * @returns Parsed object if safe
 * @throws Error if JSON is invalid or contains prototype pollution
 */
function safeJsonParse(json: string): unknown {
  const parsed = JSON.parse(json);

  if (hasPrototypePollution(parsed)) {
    throw new Error('Prototype pollution detected in JSON');
  }

  return parsed;
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
    // STEP_PHASE1_MONITOR_WORKFLOW validity is guaranteed by module-level validation at import time
    // Log at ERROR level since this indicates state corruption in issue comments
    // that may require investigation. The workflow recovers by restarting from
    // Phase 1 Step 1, but the corrupted comment should be investigated.
    logger.error(
      'validateWiggumState: invalid step value in issue comment state - possible corruption',
      {
        invalidStep: obj.step,
        invalidStepType: typeof obj.step,
        defaultingTo: STEP_PHASE1_MONITOR_WORKFLOW,
        fullStateObject: JSON.stringify(obj).substring(0, 500),
        recoveryAction: 'Workflow will restart from Phase 1 Step 1 (Monitor Workflow)',
      }
    );
    step = STEP_PHASE1_MONITOR_WORKFLOW;
  }
  const completedSteps = Array.isArray(obj.completedSteps)
    ? obj.completedSteps.filter(isValidStep)
    : [];

  // Validate phase - default to 'phase1' if invalid
  let phase: 'phase1' | 'phase2' = 'phase1';
  if (obj.phase === 'phase1' || obj.phase === 'phase2') {
    phase = obj.phase;
  } else if (obj.phase !== undefined) {
    logger.warn('validateWiggumState: invalid phase value, defaulting to phase1', {
      invalidPhase: obj.phase,
      defaultingTo: 'phase1',
    });
  }

  return { iteration, step, completedSteps, phase };
}

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
        return validateWiggumState(raw);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Log prototype pollution attempts at ERROR level for security monitoring
        const logLevel = errorMsg.includes('Prototype pollution') ? 'error' : 'warn';
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
