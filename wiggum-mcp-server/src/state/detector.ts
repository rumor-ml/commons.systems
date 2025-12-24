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
import { getWiggumState } from './comments.js';
import { getWiggumStateFromIssue } from './issue-comments.js';
import { STEP_PHASE1_MONITOR_WORKFLOW } from '../constants.js';
import { logger } from '../utils/logger.js';
import { StateDetectionError, StateApiError } from '../utils/errors.js';
import type { GitState, PRState, CurrentState, IssueState } from './types.js';
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
      logger.debug('detectPRState: no PR found for current branch', {
        repo: resolvedRepo,
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

  return {
    exists: issueNumber !== null,
    number: issueNumber ?? undefined,
  };
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
  const MAX_RECURSION_DEPTH = 3;

  const startTime = Date.now();
  const git = await detectGitState();
  const pr = await detectPRState(repo);
  const issue = detectIssueState(git);
  const stateDetectionTime = Date.now() - startTime;

  // Determine phase based on PR existence
  const phase: WiggumPhase = pr.exists ? 'phase2' : 'phase1';

  let wiggum;
  if (phase === 'phase2' && pr.exists) {
    // Phase 2: Read state from PR comments
    wiggum = await getWiggumState(pr.number, repo);
    wiggum.phase = 'phase2';

    // If state detection took longer than 5 seconds, re-validate PR state exists
    // This helps detect race conditions where PR might have been closed/modified
    if (stateDetectionTime > 5000) {
      const revalidatedPr = await detectPRState(repo);
      if (revalidatedPr.exists && revalidatedPr.number !== pr.number) {
        if (depth >= MAX_RECURSION_DEPTH) {
          logger.error(
            'detectCurrentState: maximum recursion depth exceeded during PR revalidation',
            {
              depth,
              maxDepth: MAX_RECURSION_DEPTH,
              previousPrNumber: pr.number,
              newPrNumber: revalidatedPr.number,
              stateDetectionTime,
            }
          );
          throw new StateDetectionError(
            `State detection failed: PR state changed ${depth} times during detection. ` +
              `This indicates rapid PR changes that prevent reliable state tracking. ` +
              `Previous PR: #${pr.number}, New PR: #${revalidatedPr.number}. ` +
              `Manual intervention required - verify PR state is stable before retrying.`,
            {
              depth,
              maxDepth: MAX_RECURSION_DEPTH,
              previousState: `PR #${pr.number}`,
              newState: `PR #${revalidatedPr.number}`,
              stateDetectionTime,
            }
          );
        }

        logger.warn('detectCurrentState: PR state changed during detection, revalidating', {
          depth,
          previousPrNumber: pr.number,
          newPrNumber: revalidatedPr.number,
          stateDetectionTime,
        });
        // Retry with incremented depth counter to track recursion
        return detectCurrentState(repo, depth + 1);
      }
    }
  } else if (phase === 'phase1' && issue.exists && issue.number) {
    // Phase 1: Read state from issue comments
    wiggum = await getWiggumStateFromIssue(issue.number, repo);
    wiggum.phase = 'phase1';
  } else {
    // No issue or PR, return initial Phase 1 state
    wiggum = {
      iteration: 0,
      step: STEP_PHASE1_MONITOR_WORKFLOW,
      completedSteps: [],
      phase: 'phase1' as const,
    };
  }

  return {
    git,
    pr,
    issue,
    wiggum,
  };
}
