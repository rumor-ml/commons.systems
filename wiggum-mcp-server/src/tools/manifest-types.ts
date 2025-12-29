/**
 * Shared types for manifest file operations
 *
 * This module consolidates type definitions used across manifest-related tools:
 * - read-manifests.ts
 * - manifest-utils.ts
 * - record-review-issue.ts
 *
 * Consolidation rationale:
 * 1. DRY principle - single source of truth for interface definitions
 * 2. Consistency - ensures all tools use the same field names and types
 * 3. Maintainability - changes only need to be made in one place
 */

import { z } from 'zod';

/**
 * Union type of all valid review agent names
 *
 * Provides compile-time type safety for agent names throughout the codebase:
 * - Prevents typos like 'code-reviwer' (missing 'e')
 * - Enables IDE auto-completion for agent names
 * - Validates agent_name values at compile time
 *
 * When adding a new review agent:
 * 1. Add the agent name to this union type
 * 2. Add the agent name to REVIEW_AGENT_NAMES array in manifest-utils.ts
 * 3. The Zod schema (ReviewAgentNameSchema) will automatically include it
 */
export type ReviewAgentName =
  | 'code-reviewer'
  | 'silent-failure-hunter'
  | 'code-simplifier'
  | 'comment-analyzer'
  | 'pr-test-analyzer'
  | 'type-design-analyzer';

/**
 * Array of all valid review agent names for runtime iteration
 *
 * This must be kept in sync with the ReviewAgentName union type.
 * Used for runtime validation and iteration over agent names.
 */
export const REVIEW_AGENT_NAME_VALUES: readonly ReviewAgentName[] = [
  'code-reviewer',
  'silent-failure-hunter',
  'code-simplifier',
  'comment-analyzer',
  'pr-test-analyzer',
  'type-design-analyzer',
] as const;

/**
 * Zod schema for runtime validation of ReviewAgentName
 *
 * Validates that a string is a valid review agent name at runtime.
 * The enum values are derived from the REVIEW_AGENT_NAME_VALUES array
 * to maintain a single source of truth.
 */
export const ReviewAgentNameSchema = z.enum([
  'code-reviewer',
  'silent-failure-hunter',
  'code-simplifier',
  'comment-analyzer',
  'pr-test-analyzer',
  'type-design-analyzer',
]);

/**
 * Type guard to check if a string is a valid ReviewAgentName
 *
 * @param value - String to validate
 * @returns true if value is a valid ReviewAgentName
 *
 * @example
 * if (isReviewAgentName(agentName)) {
 *   // TypeScript knows agentName is ReviewAgentName here
 * }
 */
export function isReviewAgentName(value: string): value is ReviewAgentName {
  return REVIEW_AGENT_NAME_VALUES.includes(value as ReviewAgentName);
}

/**
 * Scope indicates whether an issue is within the current PR's scope
 *
 * - 'in-scope': Issue relates directly to code changed in the current PR
 * - 'out-of-scope': Issue exists but is outside the current PR's changes
 */
export type IssueScope = 'in-scope' | 'out-of-scope';

/**
 * Priority level for review issues
 *
 * - 'high': Blocking issues that must be fixed before merge
 * - 'low': Non-blocking suggestions or future improvements
 */
export type IssuePriority = 'high' | 'low';

/**
 * Issue record stored in manifest files
 *
 * Each review agent writes issues to manifest files using this structure.
 * All fields are readonly to prevent accidental mutation during processing.
 *
 * @example
 * ```typescript
 * const issue: IssueRecord = {
 *   agent_name: 'code-reviewer',
 *   scope: 'in-scope',
 *   priority: 'high',
 *   title: 'Missing error handling in API endpoint',
 *   description: 'The /api/users endpoint does not handle database errors...',
 *   location: 'src/api/users.ts:42',
 *   timestamp: '2025-01-15T10:30:00.000Z',
 * };
 * ```
 */
export interface IssueRecord {
  /** Name of the review agent that found this issue */
  readonly agent_name: ReviewAgentName;
  /** Whether this issue is within the current PR's scope */
  readonly scope: IssueScope;
  /** Priority level for triage (high = blocking, low = suggestion) */
  readonly priority: IssuePriority;
  /** Brief title summarizing the issue */
  readonly title: string;
  /** Detailed description with context and suggested fix */
  readonly description: string;
  /** Optional file path and line number where the issue was found */
  readonly location?: string;
  /** Optional existing TODO comment related to this issue */
  readonly existing_todo?: {
    readonly has_todo: boolean;
    readonly issue_reference?: string;
  };
  /** Optional metadata with additional context (severity, confidence, etc.) */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** ISO 8601 timestamp when the issue was recorded */
  readonly timestamp: string;
  /** Files this issue requires editing (for in-scope batching) */
  readonly files_to_edit?: readonly string[];
}

/**
 * Runtime validation schema for IssueRecord
 *
 * This schema validates IssueRecord data from external sources (JSON files)
 * to catch invalid data early and provide clear error messages.
 *
 * Benefits over manual type guards:
 * - Automatically keeps type and validation in sync
 * - Validates timestamp format (ISO 8601)
 * - Consistent with WiggumState approach in state/types.ts
 * - Zod's .datetime() provides proper ISO 8601 validation
 */
const ExistingTodoSchema = z.object({
  has_todo: z.boolean(),
  issue_reference: z.string().optional(),
});

const IssueRecordSchema = z.object({
  agent_name: ReviewAgentNameSchema,
  scope: z.enum(['in-scope', 'out-of-scope']),
  priority: z.enum(['high', 'low']),
  title: z.string().min(1, 'title cannot be empty'),
  description: z.string().min(1, 'description cannot be empty'),
  location: z.string().optional(),
  existing_todo: ExistingTodoSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime({ message: 'timestamp must be valid ISO 8601 format' }),
  files_to_edit: z.array(z.string()).optional(),
});

// Export schema for validation in other modules if needed
export { IssueRecordSchema };

/**
 * Aggregated manifest data for a single agent and scope
 *
 * Used by manifest-utils to track agent completion status.
 * An agent is considered complete if:
 * 1. No in-scope manifest exists (found zero issues), OR
 * 2. Has in-scope manifest but zero high-priority issues
 *
 * **Invariants** (enforced by createAgentManifest factory):
 * - agent_name is a non-empty string
 * - scope is 'in-scope' or 'out-of-scope'
 * - issues is a readonly array of IssueRecord
 * - high_priority_count equals issues.filter(i => i.priority === 'high').length
 * - high_priority_count >= 0
 */
export interface AgentManifest {
  /** Name of the review agent */
  readonly agent_name: string;
  /** Scope of issues in this manifest */
  readonly scope: IssueScope;
  /** All issues recorded by this agent for this scope */
  readonly issues: readonly IssueRecord[];
  /** Count of high-priority issues (used for completion tracking) */
  readonly high_priority_count: number;
}

/**
 * Error thrown when AgentManifest invariants are violated
 *
 * This error indicates a programming bug - the agent_name is empty
 * or the manifest is being constructed incorrectly. This should never
 * occur when using the createAgentManifest factory correctly.
 */
export class AgentManifestInvariantError extends Error {
  constructor(
    message: string,
    public readonly manifest: Partial<AgentManifest>
  ) {
    super(`AgentManifest invariant violated: ${message}`);
    this.name = 'AgentManifestInvariantError';
  }
}

/**
 * Create an AgentManifest with invariant validation
 *
 * Factory function that computes high_priority_count from the issues array
 * and validates the agent_name. This ensures AgentManifest objects are always
 * internally consistent.
 *
 * **Why use this factory instead of object literals:**
 * 1. high_priority_count is computed correctly from issues (single source of truth)
 * 2. agent_name is validated to be non-empty
 * 3. Impossible to create inconsistent AgentManifest objects
 * 4. Centralizes manifest construction logic (DRY)
 *
 * @param agent_name - Name of the review agent (must be non-empty)
 * @param scope - Scope of issues ('in-scope' or 'out-of-scope')
 * @param issues - Array of issue records from this agent
 * @returns AgentManifest with computed high_priority_count
 * @throws {AgentManifestInvariantError} If agent_name is empty (indicates bug)
 *
 * @example
 * ```typescript
 * const manifest = createAgentManifest('code-reviewer', 'in-scope', issues);
 * // manifest.high_priority_count is automatically computed
 * ```
 */
export function createAgentManifest(
  agent_name: string,
  scope: IssueScope,
  issues: readonly IssueRecord[]
): AgentManifest {
  // Validate agent_name is non-empty
  if (!agent_name || agent_name.trim().length === 0) {
    throw new AgentManifestInvariantError('agent_name must be non-empty', {
      agent_name,
      scope,
      issues,
    });
  }

  // Compute high_priority_count from issues (single source of truth)
  const high_priority_count = issues.filter((i) => i.priority === 'high').length;

  return {
    agent_name,
    scope,
    issues,
    high_priority_count,
  };
}

/**
 * Summary statistics from aggregated manifests
 *
 * Provides counts for filtering and progress tracking.
 *
 * **Invariants** (enforced by createManifestSummary factory):
 * - total_issues === in_scope_count + out_of_scope_count
 * - total_issues === high_priority_count + low_priority_count
 * - total_issues === issues.length
 * - agents_with_issues is sorted and contains unique values
 * - All count fields are non-negative integers
 */
export interface ManifestSummary {
  /** Total number of issues across all manifests */
  readonly total_issues: number;
  /** Count of high-priority issues */
  readonly high_priority_count: number;
  /** Count of low-priority issues */
  readonly low_priority_count: number;
  /** Count of in-scope issues */
  readonly in_scope_count: number;
  /** Count of out-of-scope issues */
  readonly out_of_scope_count: number;
  /** Sorted list of agent names that reported issues */
  readonly agents_with_issues: readonly string[];
  /** All aggregated issues */
  readonly issues: readonly IssueRecord[];
}

/**
 * Error thrown when ManifestSummary invariants are violated
 *
 * This error indicates a programming bug - the counts derived from issues
 * don't match the expected relationships. This should never occur when
 * using the createManifestSummary factory correctly.
 */
export class ManifestSummaryInvariantError extends Error {
  constructor(
    message: string,
    public readonly summary: Partial<ManifestSummary>
  ) {
    super(`ManifestSummary invariant violated: ${message}`);
    this.name = 'ManifestSummaryInvariantError';
  }
}

/**
 * Create a ManifestSummary with invariant validation
 *
 * Factory function that computes all counts from the issues array and validates
 * cross-field invariants. This ensures ManifestSummary objects are always
 * internally consistent.
 *
 * **Why use this factory instead of object literals:**
 * 1. Counts are computed correctly from the issues array (single source of truth)
 * 2. agents_with_issues is guaranteed to be sorted and unique
 * 3. Cross-field invariants are validated at construction time
 * 4. Impossible to create inconsistent ManifestSummary objects
 *
 * @param issues - Array of issue records to aggregate
 * @returns ManifestSummary with computed counts and validated invariants
 * @throws {ManifestSummaryInvariantError} If invariants cannot be satisfied (indicates bug)
 *
 * @example
 * ```typescript
 * const issues: IssueRecord[] = [...];
 * const summary = createManifestSummary(issues);
 * // summary.total_issues === issues.length (guaranteed)
 * // summary.agents_with_issues is sorted (guaranteed)
 * ```
 */
export function createManifestSummary(issues: readonly IssueRecord[]): ManifestSummary {
  // Compute counts from issues array (single source of truth)
  const highPriorityIssues = issues.filter((i) => i.priority === 'high');
  const lowPriorityIssues = issues.filter((i) => i.priority === 'low');
  const inScopeIssues = issues.filter((i) => i.scope === 'in-scope');
  const outOfScopeIssues = issues.filter((i) => i.scope === 'out-of-scope');

  // Compute sorted unique agent names
  const agentSet = new Set(issues.map((i) => i.agent_name));
  const agents_with_issues = Array.from(agentSet).sort();

  const summary: ManifestSummary = {
    total_issues: issues.length,
    high_priority_count: highPriorityIssues.length,
    low_priority_count: lowPriorityIssues.length,
    in_scope_count: inScopeIssues.length,
    out_of_scope_count: outOfScopeIssues.length,
    agents_with_issues,
    issues,
  };

  // Validate invariants (should always pass when computed from issues, but verify for safety)
  if (summary.total_issues !== summary.in_scope_count + summary.out_of_scope_count) {
    throw new ManifestSummaryInvariantError(
      `scope counts do not sum to total: ` +
        `${summary.in_scope_count} + ${summary.out_of_scope_count} !== ${summary.total_issues}`,
      summary
    );
  }

  if (summary.total_issues !== summary.high_priority_count + summary.low_priority_count) {
    throw new ManifestSummaryInvariantError(
      `priority counts do not sum to total: ` +
        `${summary.high_priority_count} + ${summary.low_priority_count} !== ${summary.total_issues}`,
      summary
    );
  }

  if (summary.total_issues !== summary.issues.length) {
    throw new ManifestSummaryInvariantError(
      `total_issues does not match issues array length: ` +
        `${summary.total_issues} !== ${summary.issues.length}`,
      summary
    );
  }

  return summary;
}

/**
 * Manifest filename pattern components
 *
 * Manifest files follow the pattern: {agent-name}-{scope}-{timestamp}-{random}.json
 * This type represents the parsed components of a manifest filename.
 */
export interface ManifestFilenameComponents {
  /** Agent name extracted from filename (e.g., 'code-reviewer') */
  readonly agentName: string;
  /** Scope extracted from filename ('in-scope' or 'out-of-scope') */
  readonly scope: IssueScope;
}

/**
 * Type guard to check if a value is a valid IssueRecord
 *
 * Uses Zod schema validation for runtime safety. Useful when
 * parsing JSON manifest files where type safety is not guaranteed.
 *
 * Benefits of using Zod schema:
 * - Automatically keeps type and validation in sync
 * - Validates all required and optional fields
 * - Consistent with WiggumState approach in state/types.ts
 *
 * @param value - Value to check
 * @returns true if value matches IssueRecord structure
 */
export function isIssueRecord(value: unknown): value is IssueRecord {
  return IssueRecordSchema.safeParse(value).success;
}

/**
 * Type guard to check if an array contains only valid IssueRecords
 *
 * @param value - Value to check
 * @returns true if value is an array of valid IssueRecords
 */
export function isIssueRecordArray(value: unknown): value is IssueRecord[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(isIssueRecord);
}
