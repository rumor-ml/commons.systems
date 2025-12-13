/**
 * State detection for Wiggum flow
 */

import {
  getCurrentBranch,
  hasUncommittedChanges,
  hasRemoteTracking,
  isBranchPushed,
  getMainBranch,
} from '../utils/git.js';
import { getCurrentRepo, getPR, type GitHubPR } from '../utils/gh-cli.js';
import { getWiggumState } from './comments.js';
import type { GitState, PRState, CurrentState } from './types.js';

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
  const stateDetectionTime = Date.now() - startTime;

  let wiggum;
  if (pr.exists && pr.number) {
    wiggum = await getWiggumState(pr.number, repo);

    // If state detection took longer than 5 seconds, re-validate PR state exists
    // This helps detect race conditions where PR might have been closed/modified
    if (stateDetectionTime > 5000) {
      const revalidatedPr = await detectPRState(repo);
      if (revalidatedPr.exists && revalidatedPr.number !== pr.number) {
        console.warn(
          `detectCurrentState: PR state changed during detection (was #${pr.number}, now #${revalidatedPr.number}). Using revalidated state.`
        );
        return detectCurrentState(repo); // Recursive call to re-fetch with consistent state
      }
    }
  } else {
    wiggum = {
      iteration: 0,
      step: '0',
      completedSteps: [],
    };
  }

  return {
    git,
    pr,
    wiggum,
  };
}
