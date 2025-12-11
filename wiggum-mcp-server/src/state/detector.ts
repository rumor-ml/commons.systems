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
import { getCurrentRepo, getPR } from '../utils/gh-cli.js';
import { getWiggumState } from './comments.js';
import type { GitState, PRState, CurrentState } from './types.js';

/**
 * Detect current git state
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
 */
export async function detectPRState(repo?: string): Promise<PRState> {
  try {
    const resolvedRepo = repo || (await getCurrentRepo());

    // Try to get PR for current branch
    // gh pr view will fail if no PR exists
    const result: any = await getPR(undefined, resolvedRepo); // undefined gets PR for current branch

    return {
      exists: true,
      number: result.number,
      title: result.title,
      url: result.url,
      labels: result.labels?.map((l: any) => l.name) || [],
      headRefName: result.headRefName,
      baseRefName: result.baseRefName,
    };
  } catch (error) {
    // Expected: no PR exists for current branch (GitHubCliError)
    // Log unexpected errors
    if (error instanceof Error && !error.message.includes('no pull requests found')) {
      console.warn(`detectPRState: unexpected error while checking for PR: ${error.message}`);
    }

    return {
      exists: false,
    };
  }
}

/**
 * Detect complete current state
 */
export async function detectCurrentState(repo?: string): Promise<CurrentState> {
  const git = await detectGitState();
  const pr = await detectPRState(repo);

  let wiggum;
  if (pr.exists && pr.number) {
    wiggum = await getWiggumState(pr.number, repo);
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
