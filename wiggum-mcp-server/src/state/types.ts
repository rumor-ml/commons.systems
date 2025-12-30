/**
 * State management types for Wiggum flow
 *
 * All state interfaces use readonly modifiers to enforce immutability.
 * State should be treated as immutable snapshots - create new objects
 * rather than mutating existing state.
 */

import { z } from 'zod';
import type { WiggumStep, WiggumPhase } from '../constants.js';
import { STEP_ORDER } from '../constants.js';

/**
 * Wiggum state tracked via PR/issue body
 *
 * TODO(#323): Add state machine class with transition validation
 */
export interface WiggumState {
  readonly iteration: number;
  readonly step: WiggumStep;
  readonly completedSteps: readonly WiggumStep[];
  readonly phase: WiggumPhase;
  readonly maxIterations?: number;
}

/**
 * Git repository state
 *
 * TODO(#991): Consider adding factory function for validation consistency (may be resolved - createGitState exists)
 */
export interface GitState {
  readonly currentBranch: string;
  readonly isMainBranch: boolean;
  readonly hasUncommittedChanges: boolean;
  readonly isRemoteTracking: boolean;
  readonly isPushed: boolean;
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
 *
 * All fields are readonly since PR state represents an immutable snapshot
 * from the GitHub API. The labels array is also readonly to prevent mutation.
 */
export interface PRExists {
  readonly exists: true;
  readonly number: number;
  readonly title: string;
  readonly state: PRStateValue;
  readonly url: string;
  readonly labels: readonly string[];
  readonly headRefName: string;
  readonly baseRefName: string;
}

/**
 * PR does not exist on GitHub
 */
export interface PRDoesNotExist {
  readonly exists: false;
}

/**
 * Issue state from GitHub - using discriminated union for type safety
 *
 * This pattern eliminates invalid states at compile time. Only two valid states exist:
 * 1. IssueExists: { exists: true, number: <positive integer> }
 * 2. IssueDoesNotExist: { exists: false }
 *
 * Invalid states like { exists: true, number: undefined } are now impossible.
 */
export type IssueState = IssueExists | IssueDoesNotExist;

/**
 * Issue exists (extracted from branch name)
 */
export interface IssueExists {
  readonly exists: true;
  readonly number: number;
}

/**
 * Issue does not exist (branch name doesn't contain issue number)
 */
export interface IssueDoesNotExist {
  readonly exists: false;
}

/**
 * Complete current state for wiggum flow
 *
 * TODO(#980): Consider adding runtime validation schema similar to WiggumState (may be resolved - CurrentStateSchema exists)
 */
export interface CurrentState {
  readonly git: GitState;
  readonly pr: PRState;
  readonly issue: IssueState;
  readonly wiggum: WiggumState;
}

/**
 * Runtime validation schemas for state types
 *
 * These schemas validate state constructed from external sources (GitHub API, git CLI)
 * to catch invalid data early and provide clear error messages.
 */

const GitStateSchema = z
  .object({
    currentBranch: z.string().min(1, 'currentBranch cannot be empty'),
    isMainBranch: z.boolean(),
    hasUncommittedChanges: z.boolean(),
    isRemoteTracking: z.boolean(),
    isPushed: z.boolean(),
  })
  .refine(
    (data) => {
      // If not tracking remote, cannot be pushed
      if (!data.isRemoteTracking && data.isPushed) {
        return false;
      }
      return true;
    },
    { message: 'isPushed requires isRemoteTracking to be true' }
  );

/**
 * Create a validated GitState object
 *
 * This factory function ensures all GitState objects pass runtime validation
 * through GitStateSchema.parse(), catching invalid data early and enforcing
 * all invariants (non-empty branch name, cross-field consistency).
 *
 * Cross-field validation:
 * - isPushed requires isRemoteTracking to be true (cannot push without tracking remote)
 *
 * Use this factory instead of direct object construction to guarantee validation:
 * - GOOD: createGitState({ currentBranch: 'main', isMainBranch: true, ... })
 * - AVOID: const git: GitState = { currentBranch: 'main', ... }
 *
 * @param state - Git state data to validate
 * @returns Validated GitState with all invariants verified
 * @throws {z.ZodError} If validation fails (empty branch name, isPushed without tracking, etc.)
 */
export function createGitState(state: {
  readonly currentBranch: string;
  readonly isMainBranch: boolean;
  readonly hasUncommittedChanges: boolean;
  readonly isRemoteTracking: boolean;
  readonly isPushed: boolean;
}): GitState {
  return GitStateSchema.parse(state);
}

const PRStateValueSchema = z.enum(['OPEN', 'CLOSED', 'MERGED']);

const PRExistsSchema = z.object({
  exists: z.literal(true),
  number: z.number().int().positive('PR number must be positive integer'),
  title: z.string(),
  state: PRStateValueSchema,
  url: z.string().url('PR URL must be valid URL'),
  labels: z.array(z.string()).readonly(),
  headRefName: z.string().min(1, 'headRefName cannot be empty'),
  baseRefName: z.string().min(1, 'baseRefName cannot be empty'),
});

const PRDoesNotExistSchema = z.object({
  exists: z.literal(false),
});

const PRStateSchema = z.discriminatedUnion('exists', [PRExistsSchema, PRDoesNotExistSchema]);

/**
 * Create a validated PRExists object
 *
 * This factory function ensures all PRExists objects pass runtime validation
 * through PRExistsSchema.parse(), catching invalid data early and enforcing
 * all invariants (positive PR number, valid URL, non-empty branch names, etc.).
 *
 * Use this factory instead of direct object construction to guarantee validation:
 * - GOOD: createPRExists({ number: 123, title: 'Fix bug', ... })
 * - AVOID: const pr: PRExists = { exists: true, number: 123, ... }
 *
 * @param data - PR data to validate (without exists field, which is set automatically)
 * @returns Validated PRExists with all invariants verified
 * @throws {z.ZodError} If validation fails (invalid URL, empty branch names, etc.)
 */
export function createPRExists(data: {
  readonly number: number;
  readonly title: string;
  readonly state: PRStateValue;
  readonly url: string;
  readonly labels: readonly string[];
  readonly headRefName: string;
  readonly baseRefName: string;
}): PRExists {
  const pr: PRExists = { exists: true, ...data };
  return PRExistsSchema.parse(pr);
}

/**
 * Create a validated PRDoesNotExist object
 *
 * This factory function provides a type-safe way to create the "PR not found" state.
 * While PRDoesNotExist is simple (just { exists: false }), using this factory:
 * - Ensures consistency with the createPRExists pattern
 * - Allows adding validation/invariants in the future without breaking callers
 * - Documents intent clearly in calling code
 *
 * @returns Validated PRDoesNotExist object
 */
export function createPRDoesNotExist(): PRDoesNotExist {
  return PRDoesNotExistSchema.parse({ exists: false });
}

/**
 * Type guard to check if a PRState indicates an existing PR
 *
 * Provides convenient type narrowing for PRState discriminated unions,
 * consistent with the isToolError() pattern in mcp-common/types.ts.
 *
 * @param state - PRState to check
 * @returns true if PR exists, with type narrowing to PRExists
 *
 * @example
 * ```typescript
 * if (isPRExists(state)) {
 *   console.log(state.number, state.url);  // TypeScript knows all PR fields exist
 * }
 * ```
 */
export function isPRExists(state: PRState): state is PRExists {
  return state.exists === true;
}

/**
 * Type guard to check if a PRState indicates no PR
 *
 * Provides convenient type narrowing for PRState discriminated unions,
 * consistent with the isToolSuccess() pattern in mcp-common/types.ts.
 *
 * @param state - PRState to check
 * @returns true if PR does not exist, with type narrowing to PRDoesNotExist
 *
 * @example
 * ```typescript
 * if (isPRDoesNotExist(state)) {
 *   console.log('No PR exists for this branch');
 * }
 * ```
 */
export function isPRDoesNotExist(state: PRState): state is PRDoesNotExist {
  return state.exists === false;
}

const IssueExistsSchema = z.object({
  exists: z.literal(true),
  number: z.number().int().positive('Issue number must be positive integer'),
});

const IssueDoesNotExistSchema = z.object({
  exists: z.literal(false),
});

const IssueStateSchema = z.discriminatedUnion('exists', [
  IssueExistsSchema,
  IssueDoesNotExistSchema,
]);

/**
 * Create a validated IssueExists object
 *
 * This factory function ensures all IssueExists objects pass runtime validation
 * through IssueExistsSchema.parse(), catching invalid data early and enforcing
 * all invariants (positive issue number).
 *
 * Use this factory instead of direct object construction to guarantee validation:
 * - GOOD: createIssueExists(123)
 * - AVOID: const issue: IssueExists = { exists: true, number: 123 }
 *
 * @param number - Issue number (must be positive integer)
 * @returns Validated IssueExists with all invariants verified
 * @throws {z.ZodError} If validation fails (non-positive issue number, etc.)
 */
export function createIssueExists(number: number): IssueExists {
  const issue: IssueExists = { exists: true, number };
  return IssueExistsSchema.parse(issue);
}

/**
 * Create a validated IssueDoesNotExist object
 *
 * This factory function provides a type-safe way to create the "issue not found" state.
 * While IssueDoesNotExist is simple (just { exists: false }), using this factory:
 * - Ensures consistency with the createIssueExists pattern
 * - Allows adding validation/invariants in the future without breaking callers
 * - Documents intent clearly in calling code
 *
 * @returns Validated IssueDoesNotExist object
 */
export function createIssueDoesNotExist(): IssueDoesNotExist {
  return IssueDoesNotExistSchema.parse({ exists: false });
}

/**
 * Type guard to check if an IssueState indicates an existing issue
 *
 * Provides convenient type narrowing for IssueState discriminated unions,
 * consistent with the isToolError() pattern in mcp-common/types.ts.
 *
 * @param state - IssueState to check
 * @returns true if issue exists, with type narrowing to IssueExists
 *
 * @example
 * ```typescript
 * if (isIssueExists(state)) {
 *   console.log(state.number);  // TypeScript knows number exists
 * }
 * ```
 */
export function isIssueExists(state: IssueState): state is IssueExists {
  return state.exists === true;
}

/**
 * Type guard to check if an IssueState indicates no issue
 *
 * Provides convenient type narrowing for IssueState discriminated unions,
 * consistent with the isToolSuccess() pattern in mcp-common/types.ts.
 *
 * @param state - IssueState to check
 * @returns true if issue does not exist, with type narrowing to IssueDoesNotExist
 *
 * @example
 * ```typescript
 * if (isIssueDoesNotExist(state)) {
 *   console.log('No issue linked to branch');
 * }
 * ```
 */
export function isIssueDoesNotExist(state: IssueState): state is IssueDoesNotExist {
  return state.exists === false;
}

const WiggumStateSchema = z
  .object({
    iteration: z.number().int().nonnegative('iteration must be non-negative integer'),
    step: z.enum(STEP_ORDER as readonly [WiggumStep, ...WiggumStep[]]),
    completedSteps: z
      .array(z.enum(STEP_ORDER as readonly [WiggumStep, ...WiggumStep[]]))
      .readonly(),
    phase: z.enum(['phase1', 'phase2']),
    maxIterations: z.number().int().positive('maxIterations must be positive integer').optional(),
  })
  .refine(
    (data) => {
      // Validate completedSteps only contain steps before current step in STEP_ORDER
      const currentIndex = STEP_ORDER.indexOf(data.step);
      return data.completedSteps.every((s) => STEP_ORDER.indexOf(s) < currentIndex);
    },
    {
      message: 'completedSteps must only contain steps before current step in STEP_ORDER',
    }
  )
  .refine(
    (data) => {
      // Validate phase-step consistency: phase1 uses p1-* steps, phase2 uses p2-* steps
      const phasePrefix = data.phase === 'phase1' ? 'p1-' : 'p2-';
      // Special case: 'approval' step is valid in phase2 even though it doesn't have p2- prefix
      const stepValid = data.step === 'approval' || data.step.startsWith(phasePrefix);
      // completedSteps in phase2 can include p1-* steps (from previous phase) and 'approval'
      const completedValid = data.completedSteps.every(
        (s) => s === 'approval' || s.startsWith('p1-') || s.startsWith(phasePrefix)
      );
      return stepValid && completedValid;
    },
    {
      message: 'phase and step/completedSteps prefixes must be consistent',
    }
  );

// Export schema for validation in other modules (e.g., state update validation)
export { WiggumStateSchema };

/**
 * Create a validated WiggumState object
 *
 * This factory function ensures all WiggumState objects pass runtime validation
 * through WiggumStateSchema.parse(), catching invalid state early and enforcing
 * all invariants (step ordering, phase consistency, non-negative iteration, etc.).
 *
 * Use this factory instead of direct object construction to guarantee validation:
 * - GOOD: createWiggumState({ iteration: 0, step: 'p1-1', ... })
 * - AVOID: const state: WiggumState = { iteration: 0, step: 'p1-1', ... }
 *
 * @param state - State data to validate
 * @returns Validated WiggumState with all invariants verified
 * @throws {z.ZodError} If validation fails (invalid step order, phase mismatch, etc.)
 */
export function createWiggumState(state: {
  readonly iteration: number;
  readonly step: WiggumStep;
  readonly completedSteps: readonly WiggumStep[];
  readonly phase: WiggumPhase;
  readonly maxIterations?: number;
}): WiggumState {
  return WiggumStateSchema.parse(state);
}

const CurrentStateSchema = z.object({
  git: GitStateSchema,
  pr: PRStateSchema,
  issue: IssueStateSchema,
  wiggum: WiggumStateSchema,
});

/**
 * Validates CurrentState data from external sources
 *
 * @throws {z.ZodError} If validation fails with detailed error information
 */
export function validateCurrentState(data: unknown): CurrentState {
  return CurrentStateSchema.parse(data);
}

/**
 * Create a validated CurrentState object
 *
 * This factory function ensures all CurrentState objects pass runtime validation
 * through CurrentStateSchema.parse(), catching invalid data early and enforcing
 * all invariants from nested state types (GitState, PRState, IssueState, WiggumState).
 *
 * Use this factory instead of direct object construction to guarantee validation:
 * - GOOD: createCurrentState({ git: createGitState(...), pr: createPRExists(...), ... })
 * - AVOID: const state: CurrentState = { git: {...}, pr: {...}, ... }
 *
 * For untyped data from external sources (e.g., parsed JSON), use validateCurrentState instead.
 *
 * @param state - State data with typed sub-objects
 * @returns Validated CurrentState with all invariants verified
 * @throws {z.ZodError} If validation fails (invalid git state, PR state, issue state, or wiggum state)
 */
export function createCurrentState(state: {
  readonly git: GitState;
  readonly pr: PRState;
  readonly issue: IssueState;
  readonly wiggum: WiggumState;
}): CurrentState {
  return CurrentStateSchema.parse(state);
}
