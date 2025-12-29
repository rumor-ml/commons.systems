/**
 * State detection for Wiggum flow
 */

import {
  getCurrentBranch,
  hasUncommittedChanges,
  hasRemoteTracking,
  isBranchPushed,
  getMainBranch,
  extractIssueNumberFromBranch,
} from '../utils/git.js';
import { getCurrentRepo, getPR, type GitHubPR } from '../utils/gh-cli.js';
import { getWiggumStateFromPRBody, getWiggumStateFromIssueBody } from './body-state.js';
import { STEP_PHASE1_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_WORKFLOW } from '../constants.js';
import { logger } from '../utils/logger.js';
import { StateDetectionError, StateApiError } from '../utils/errors.js';
import type { GitState, PRState, CurrentState, IssueState, WiggumState } from './types.js';
import { validateCurrentState, createIssueExists, createIssueDoesNotExist } from './types.js';
import type { WiggumPhase } from '../constants.js';

/**
 * Detect current git state
 *
 * Gathers comprehensive git repository state including current branch,
 * uncommitted changes, remote tracking status, and push status.
 *
 * @returns GitState with current branch, uncommitted changes, tracking, and push status
 * @throws {GitError} When git commands fail
 *
 * @example
 * ```typescript
 * const gitState = await detectGitState();
 * if (gitState.hasUncommittedChanges) {
 *   console.log("Please commit your changes");
 * }
 * ```
 */
export async function detectGitState(): Promise<GitState> {
  const currentBranch = await getCurrentBranch();
  const mainBranch = await getMainBranch();
  const isMainBranch = currentBranch === mainBranch;
  const uncommitted = await hasUncommittedChanges();
  const remoteTracking = await hasRemoteTracking(currentBranch);
  const pushed = await isBranchPushed(currentBranch);

  return {
    currentBranch,
    isMainBranch,
    hasUncommittedChanges: uncommitted,
    isRemoteTracking: remoteTracking,
    isPushed: pushed,
  };
}

/**
 * Detect current PR state
 *
 * Attempts to find a PR for the current branch. Returns PR details if found,
 * or { exists: false } if no PR exists. Logs warnings for unexpected errors
 * but treats "no pull requests found" as expected.
 *
 * @param repo - Optional repository in "owner/repo" format
 * @returns PRState with PR details if exists, or { exists: false } if not
 *
 * @example
 * ```typescript
 * const prState = await detectPRState();
 * if (prState.exists) {
 *   console.log(`PR #${prState.number}: ${prState.title}`);
 * }
 * ```
 */
export async function detectPRState(repo?: string): Promise<PRState> {
  let resolvedRepo: string;

  // TODO(#477): Explain when repo parameter used vs getCurrentRepo() call
  try {
    resolvedRepo = repo || (await getCurrentRepo());
  } catch (repoError) {
    // Failed to determine repository - throw StateApiError with guidance
    const errorMsg = repoError instanceof Error ? repoError.message : String(repoError);
    logger.error('detectPRState: failed to determine repository', {
      providedRepo: repo,
      errorMessage: errorMsg,
      errorType: repoError instanceof Error ? repoError.constructor.name : typeof repoError,
    });
    throw new StateApiError(
      `Failed to detect PR state: Could not determine current repository. ` +
        `Ensure you are in a git repository with a GitHub remote. Error: ${errorMsg}`,
      'read',
      'pr',
      undefined,
      repoError instanceof Error ? repoError : undefined
    );
  }

  try {
    // Try to get PR for current branch
    // gh pr view will fail if no PR exists
    const result: GitHubPR = await getPR(undefined, resolvedRepo); // undefined gets PR for current branch

    // ONLY treat OPEN PRs as existing PRs for wiggum workflow
    // Closed/Merged PRs should be treated as non-existent to avoid state pollution
    // This prevents carrying over workflow state from closed PRs to new PRs on the same branch
    if (result.state !== 'OPEN') {
      logger.debug('detectPRState: found non-open PR, treating as non-existent', {
        prNumber: result.number,
        prState: result.state,
        repo: resolvedRepo,
      });
      return {
        exists: false,
      };
    }

    return {
      exists: true,
      number: result.number,
      title: result.title,
      state: result.state,
      url: result.url,
      labels: result.labels?.map((l) => l.name) || [],
      headRefName: result.headRefName,
      baseRefName: result.baseRefName,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const lowerMsg = errorMsg.toLowerCase();

    // TODO(#478): Extract shared error classification patterns
    // Expected error: no PR exists for current branch
    if (
      lowerMsg.includes('no pull requests found') ||
      lowerMsg.includes('could not resolve to a pullrequest')
    ) {
      // INFO level: This is a normal workflow state (Phase 1 has no PR yet)
      // Log the matched pattern to aid debugging if expectations change
      const matchedPattern = lowerMsg.includes('no pull requests found')
        ? 'no pull requests found'
        : 'could not resolve to a pullrequest';
      logger.info('detectPRState: no PR found for current branch', {
        repo: resolvedRepo,
        matchedPattern,
      });
      return {
        exists: false,
      };
    }

    // Rate limit errors - throw StateApiError with specific guidance
    if (lowerMsg.includes('rate limit') || lowerMsg.includes('api rate limit exceeded')) {
      logger.error('detectPRState: GitHub API rate limit exceeded', {
        repo: resolvedRepo,
        errorMessage: errorMsg,
      });
      throw new StateApiError(
        `Failed to detect PR state: GitHub API rate limit exceeded. ` +
          `Check rate limit status with: gh api rate_limit`,
        'read',
        'pr',
        undefined,
        error instanceof Error ? error : undefined
      );
    }

    // Auth errors - throw StateApiError with auth guidance
    if (
      lowerMsg.includes('forbidden') ||
      lowerMsg.includes('unauthorized') ||
      lowerMsg.includes('http 403') ||
      lowerMsg.includes('http 401')
    ) {
      logger.error('detectPRState: GitHub authentication failed', {
        repo: resolvedRepo,
        errorMessage: errorMsg,
      });
      throw new StateApiError(
        `Failed to detect PR state: GitHub authentication failed. ` +
          `Check auth status with: gh auth status`,
        'read',
        'pr',
        undefined,
        error instanceof Error ? error : undefined
      );
    }

    // Network errors - throw StateApiError (retryable)
    if (
      lowerMsg.includes('network') ||
      lowerMsg.includes('timeout') ||
      lowerMsg.includes('econnrefused') ||
      lowerMsg.includes('enotfound')
    ) {
      logger.error('detectPRState: Network error while checking for PR', {
        repo: resolvedRepo,
        errorMessage: errorMsg,
      });
      throw new StateApiError(
        `Failed to detect PR state: Network error. ` +
          `Check connectivity and retry. Error: ${errorMsg}`,
        'read',
        'pr',
        undefined,
        error instanceof Error ? error : undefined
      );
    }

    // Unknown error - throw StateApiError with full context
    logger.error('detectPRState: unexpected error while checking for PR', {
      repo: resolvedRepo,
      errorMessage: errorMsg,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined,
    });
    throw new StateApiError(
      `Failed to detect PR state: Unexpected error. ${errorMsg}`,
      'read',
      'pr',
      undefined,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Detect issue state from branch name
 *
 * Attempts to extract an issue number from the current branch name.
 * Branch names following the convention "123-feature-name" will have
 * the issue number extracted.
 *
 * @param git - Git state containing the current branch name
 * @returns IssueState with issue number if found, or { exists: false } if not
 *
 * @example
 * ```typescript
 * const git = await detectGitState();
 * const issue = await detectIssueState(git);
 * if (issue.exists) {
 *   console.log(`Working on issue #${issue.number}`);
 * }
 * ```
 */
function detectIssueState(git: GitState): IssueState {
  const issueNumber = extractIssueNumberFromBranch(git.currentBranch);

  if (issueNumber !== null) {
    return createIssueExists(issueNumber);
  }
  return createIssueDoesNotExist();
}

/**
 * Detect complete current state
 *
 * Combines git state, PR state, and wiggum workflow state into a single
 * comprehensive snapshot. This is the primary state detection function
 * used by wiggum_init and completion tools to determine next steps.
 *
 * Includes timestamp-based validation to detect race conditions where PR state
 * changes between reads. If inconsistencies are detected, state is re-fetched.
 * Recursion is limited to 3 attempts to prevent infinite loops.
 *
 * @param repo - Optional repository in "owner/repo" format
 * @param depth - Recursion depth counter (internal, defaults to 0)
 * @returns CurrentState with git, PR, and wiggum workflow state
 * @throws {GitError | GitHubCliError} When state detection fails
 *
 * @example
 * ```typescript
 * const state = await detectCurrentState();
 * console.log(`Branch: ${state.git.currentBranch}`);
 * if (state.pr.exists) {
 *   console.log(`PR #${state.pr.number}: ${state.pr.title}`);
 * }
 * console.log(`Iteration: ${state.wiggum.iteration}`);
 * ```
 */
export async function detectCurrentState(repo?: string, depth = 0): Promise<CurrentState> {
  // Validate depth parameter FIRST - before any work
  // Catches undefined, NaN, negative, or non-integer values that would bypass the depth check
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new StateDetectionError(
      `Invalid recursion depth parameter: ${depth}. Must be non-negative safe integer.`,
      { depth, maxDepth: 3 }
    );
  }

  const MAX_RECURSION_DEPTH = 3;

  // Check depth limit: MAX_RECURSION_DEPTH=3 means depths 0,1,2 allowed; 3+ rejected
  if (depth >= MAX_RECURSION_DEPTH) {
    logger.error('detectCurrentState: maximum recursion depth exceeded', {
      depth,
      maxDepth: MAX_RECURSION_DEPTH,
      action: 'State is changing too rapidly - manual intervention required',
    });
    throw new StateDetectionError(
      `State detection failed: exceeded maximum recursion depth (${MAX_RECURSION_DEPTH}). ` +
        `This indicates rapid state changes preventing reliable detection. ` +
        `Manual intervention required.`,
      { depth, maxDepth: MAX_RECURSION_DEPTH }
    );
  }

  const startTime = Date.now();
  const git = await detectGitState();
  const pr = await detectPRState(repo);
  logger.debug('detectCurrentState: PR detection complete', {
    prExists: pr.exists,
    prNumber: pr.exists ? pr.number : undefined,
    prState: pr.exists ? pr.state : undefined,
    prTitle: pr.exists ? pr.title : undefined,
  });
  const issue = detectIssueState(git);
  logger.debug('detectCurrentState: issue detection complete', {
    issueExists: issue.exists,
    issueNumber: issue.exists ? issue.number : undefined,
  });
  const stateDetectionTime = Date.now() - startTime;

  // Determine phase based on PR existence
  const phase: WiggumPhase = pr.exists ? 'phase2' : 'phase1';
  logger.info('detectCurrentState: phase determined', {
    phase,
    reason: pr.exists ? 'PR exists (open)' : 'No open PR',
  });

  let wiggum: WiggumState;
  if (phase === 'phase2' && pr.exists) {
    // Phase 2: Read state from PR body
    const prWiggum = await getWiggumStateFromPRBody(pr.number, repo);
    logger.info('detectCurrentState: read state from PR body', {
      prNumber: pr.number,
      stateFound: prWiggum !== null,
      stateValue: prWiggum,
    });
    wiggum = prWiggum
      ? { ...prWiggum, phase: 'phase2' }
      : { iteration: 0, step: STEP_PHASE2_MONITOR_WORKFLOW, completedSteps: [], phase: 'phase2' };
    logger.info('detectCurrentState: wiggum state for phase2', {
      wiggum,
      wasInitialized: prWiggum === null,
    });

    // If state detection took longer than 5 seconds, re-validate PR state
    // to detect race conditions where PR might have been closed/modified during the slow API call.
    // Note: This is at most one recursive call per invocation (not a loop), with overall depth limit enforced above.
    if (stateDetectionTime > 5000) {
      const revalidatedPr = await detectPRState(repo);
      // Only retry if a DIFFERENT PR is now current - indicates race condition
      // If revalidatedPr matches original pr.number, or PR no longer exists, original state is valid
      if (revalidatedPr.exists && revalidatedPr.number !== pr.number) {
        // Check if recursion would exceed limit BEFORE making the recursive call
        // This prevents wasted work when depth=2 and next call would immediately fail at depth=3
        if (depth + 1 >= MAX_RECURSION_DEPTH) {
          logger.error('detectCurrentState: would exceed recursion limit on retry - aborting', {
            currentDepth: depth,
            maxDepth: MAX_RECURSION_DEPTH,
            originalPrNumber: pr.number,
            newPrNumber: revalidatedPr.number,
            stateDetectionTime,
            action: 'Aborting before wasting API calls on doomed retry',
            impact: 'State detection cannot proceed - manual intervention required',
          });
          throw new StateDetectionError(
            `State detection failed: PR state changed during detection (PR #${pr.number} -> #${revalidatedPr.number}) ` +
              `but retry would exceed maximum recursion depth (${MAX_RECURSION_DEPTH}). ` +
              `This indicates rapid PR state changes. Manual intervention required.`,
            { depth: depth + 1, maxDepth: MAX_RECURSION_DEPTH }
          );
        }

        // ERROR level - this is a race condition that discards work and retries
        // Users need visibility that original state detection was wasted
        logger.error(
          'detectCurrentState: PR state race condition detected - discarding original state',
          {
            depth,
            newDepth: depth + 1,
            originalPrNumber: pr.number,
            newPrNumber: revalidatedPr.number,
            stateDetectionTime,
            action: 'Recursively redetecting entire state',
            impact: 'Original state detection wasted - all API calls will be repeated',
            maxDepthRemaining: MAX_RECURSION_DEPTH - depth - 1,
          }
        );
        // Retry with incremented depth
        return detectCurrentState(repo, depth + 1);
      }
    }
  } else if (phase === 'phase1' && issue.exists && issue.number) {
    // Phase 1: Read state from issue body
    const issueWiggum = await getWiggumStateFromIssueBody(issue.number, repo);
    logger.info('detectCurrentState: read state from issue body', {
      issueNumber: issue.number,
      stateFound: issueWiggum !== null,
      stateValue: issueWiggum,
    });
    wiggum = issueWiggum
      ? { ...issueWiggum, phase: 'phase1' }
      : { iteration: 0, step: STEP_PHASE1_MONITOR_WORKFLOW, completedSteps: [], phase: 'phase1' };
    logger.info('detectCurrentState: wiggum state for phase1', {
      wiggum,
      wasInitialized: issueWiggum === null,
    });
  } else {
    // No issue or PR, return initial Phase 1 state
    wiggum = {
      iteration: 0,
      step: STEP_PHASE1_MONITOR_WORKFLOW,
      completedSteps: [],
      phase: 'phase1' as const,
    };
  }

  // Validate state before returning to catch invalid data from external sources
  // This ensures state conforms to expected types and constraints
  const state = {
    git,
    pr,
    issue,
    wiggum,
  };

  try {
    return validateCurrentState(state);
  } catch (error) {
    const zodError = error instanceof Error ? error : new Error(String(error));

    // Determine state source for error message
    const stateSource =
      phase === 'phase2' && pr.exists
        ? `PR #${pr.number} body`
        : issue.exists && issue.number
          ? `Issue #${issue.number} body`
          : 'created initial state';

    logger.error('detectCurrentState: STATE VALIDATION FAILED', {
      phase,
      stateSource,
      validationError: zodError.message,
      invalidState: JSON.stringify(state.wiggum),
      prExists: pr.exists,
      prNumber: pr.exists ? pr.number : undefined,
      issueExists: issue.exists,
      issueNumber: issue.exists ? issue.number : undefined,
      userAction: 'Check the state source and manually remove/fix the wiggum-state HTML comment',
    });

    throw new StateDetectionError(
      `State validation failed for state from ${stateSource}: ${zodError.message}\n\n` +
        `Invalid state: ${JSON.stringify(state.wiggum, null, 2)}\n\n` +
        `This indicates corrupted state data. To fix:\n` +
        `1. View the ${stateSource}\n` +
        `2. Locate the HTML comment: <!-- wiggum-state:... -->\n` +
        `3. Remove the comment entirely to reset the workflow\n` +
        `4. Or fix the JSON to ensure completedSteps only contains steps before the current step`,
      {
        depth,
        maxDepth: MAX_RECURSION_DEPTH,
        previousState: 'validation failed',
        currentState: 'validation failed',
      }
    );
  }
}
