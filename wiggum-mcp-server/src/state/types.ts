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
 * PR state from GitHub
 */
export interface PRState {
  exists: boolean;
  number?: number;
  title?: string;
  url?: string;
  labels?: string[];
  headRefName?: string;
  baseRefName?: string;
}

/**
 * Complete current state for wiggum flow
 */
export interface CurrentState {
  git: GitState;
  pr: PRState;
  wiggum: WiggumState;
}
