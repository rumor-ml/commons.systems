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
 */
export interface WiggumState {
  readonly iteration: number;
  readonly step: WiggumStep;
  readonly completedSteps: readonly WiggumStep[];
  readonly phase: WiggumPhase;
  readonly maxIterations?: number;
  readonly completedAgents?: readonly string[];
  readonly pendingCompletionAgents?: readonly string[];
}

/**
 * Git repository state
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
 * Issue state from GitHub
 */
export interface IssueState {
  readonly exists: boolean;
  readonly number?: number;
}

/**
 * Complete current state for wiggum flow
 */
// TODO(#980): Consider adding createCurrentState factory function for consistency with other state types
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

const GitStateSchema = z.object({
  currentBranch: z.string().min(1, 'currentBranch cannot be empty'),
  isMainBranch: z.boolean(),
  hasUncommittedChanges: z.boolean(),
  isRemoteTracking: z.boolean(),
  isPushed: z.boolean(),
});

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

const IssueStateSchema = z.object({
  exists: z.boolean(),
  number: z.number().int().positive('Issue number must be positive integer').optional(),
});

const WiggumStateSchema = z
  .object({
    iteration: z.number().int().nonnegative('iteration must be non-negative integer'),
    step: z.enum(STEP_ORDER as readonly [WiggumStep, ...WiggumStep[]]),
    completedSteps: z
      .array(z.enum(STEP_ORDER as readonly [WiggumStep, ...WiggumStep[]]))
      .readonly(),
    phase: z.enum(['phase1', 'phase2']),
    maxIterations: z.number().int().positive('maxIterations must be positive integer').optional(),
    completedAgents: z.array(z.string()).readonly().optional(),
    pendingCompletionAgents: z.array(z.string()).readonly().optional(),
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
      const stepValid = data.step.startsWith(phasePrefix);
      // completedSteps in phase2 can include p1-* steps (from previous phase)
      const completedValid = data.completedSteps.every(
        (s) => s.startsWith('p1-') || s.startsWith(phasePrefix)
      );
      return stepValid && completedValid;
    },
    {
      message: 'phase and step/completedSteps prefixes must be consistent',
    }
  )
  .refine(
    (data) => {
      // Validate mutual exclusion: an agent cannot be both completed and pending completion
      if (!data.completedAgents || !data.pendingCompletionAgents) {
        return true; // Skip if either is undefined
      }
      const completed = new Set(data.completedAgents);
      return !data.pendingCompletionAgents.some((agent) => completed.has(agent));
    },
    {
      message: 'completedAgents and pendingCompletionAgents must be mutually exclusive',
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
  readonly completedAgents?: readonly string[];
  readonly pendingCompletionAgents?: readonly string[];
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
