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
  try {
    const resolvedRepo = repo || (await getCurrentRepo());

    // Try to get PR for current branch
    // gh pr view will fail if no PR exists
    const result: GitHubPR = await getPR(undefined, resolvedRepo); // undefined gets PR for current branch

    // ONLY treat OPEN PRs as existing PRs for wiggum workflow
    // Closed/Merged PRs should be treated as non-existent to avoid state pollution
    // This prevents carrying over workflow state from closed PRs to new PRs on the same branch
    if (result.state !== 'OPEN') {
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
    // Expected: no PR exists for current branch (GitHubCliError)
    // Log unexpected errors with full context
    if (error instanceof Error) {
      const isExpectedError = error.message.includes('no pull requests found');

      if (!isExpectedError) {
        // Unexpected error - provide full diagnostic information
        console.warn(`detectPRState: unexpected error while checking for PR: ${error.message}`, {
          repo,
          errorType: error.constructor.name,
          stack: error.stack?.split('\n').slice(0, 3).join('\n'), // First 3 lines of stack
        });
      }
    } else {
      // Non-Error thrown - log it
      console.warn(`detectPRState: unexpected non-Error thrown: ${String(error)}`);
    }

    return {
      exists: false,
    };
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
async function detectIssueState(git: GitState): Promise<IssueState> {
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
 *
 * @param repo - Optional repository in "owner/repo" format
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
export async function detectCurrentState(repo?: string): Promise<CurrentState> {
  const startTime = Date.now();
  const git = await detectGitState();
  const pr = await detectPRState(repo);
  const issue = await detectIssueState(git);
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
        logger.warn(
          'detectCurrentState: PR state changed during detection, using revalidated state',
          {
            previousPrNumber: pr.number,
            newPrNumber: revalidatedPr.number,
            stateDetectionTime,
          }
        );
        // Note: Recursive call with no depth limit is acceptable here because:
        // 1. Race condition requires stateDetectionTime > 5000ms (unusual)
        // 2. PR number change between reads is rare (external actor closing PR)
        // 3. Worst case: PR keeps changing (very unlikely), eventually timeout at caller
        return detectCurrentState(repo);
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
