/**
 * State management types for Wiggum flow
 */

import type { WiggumStep } from '../constants.js';

/**
 * Wiggum state tracked via PR comments
 */
export interface WiggumState {
  iteration: number;
  step: WiggumStep;
  completedSteps: WiggumStep[];
}

/**
 * Git repository state
 */
export interface GitState {
  currentBranch: string;
  isMainBranch: boolean;
  hasUncommittedChanges: boolean;
  isRemoteTracking: boolean;
  isPushed: boolean;
}

/**
 * Valid PR state values from GitHub API
 */
export type PRStateValue = 'OPEN' | 'CLOSED' | 'MERGED';

/**
 * PR state from GitHub - using discriminated union for type safety
 */
export type PRState = PRExists | PRDoesNotExist;

/**
 * PR exists on GitHub
 */
export interface PRExists {
  exists: true;
  number: number;
  title: string;
  state: PRStateValue;
  url: string;
  labels: string[];
  headRefName: string;
  baseRefName: string;
}

/**
 * PR does not exist on GitHub
 */
export interface PRDoesNotExist {
  exists: false;
}

/**
 * Complete current state for wiggum flow
 */
export interface CurrentState {
  git: GitState;
  pr: PRState;
  wiggum: WiggumState;
}
