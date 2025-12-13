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
  state: string; // "OPEN" | "CLOSED" | "MERGED"
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
 * Type constraint for PR state values - ensures only valid PRState types
 * This prevents accidental narrowing to incompatible types in CurrentStateWithPR
 */
export type PRStateValue = PRExists | PRDoesNotExist;

/**
 * Complete current state for wiggum flow
 */
export interface CurrentState {
  git: GitState;
  pr: PRState;
  wiggum: WiggumState;
}
