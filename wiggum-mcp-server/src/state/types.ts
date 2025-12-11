/**
 * State management types for Wiggum flow
 */

/**
 * Wiggum state tracked via PR comments
 */
export interface WiggumState {
  iteration: number;
  step: string; // Step identifier (e.g., "0", "1", "1b", "2", "3", "4", "4b", "approval")
  completedSteps: string[]; // List of completed step identifiers
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
