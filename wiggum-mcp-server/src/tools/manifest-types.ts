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
  readonly agent_name: string;
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
}

/**
 * Aggregated manifest data for a single agent and scope
 *
 * Used by manifest-utils to track agent completion status.
 * An agent is considered complete if:
 * 1. No in-scope manifest exists (found zero issues), OR
 * 2. Has in-scope manifest but zero high-priority issues
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
 * Summary statistics from aggregated manifests
 *
 * Provides counts for filtering and progress tracking.
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
 * Performs runtime validation of IssueRecord structure. Useful when
 * parsing JSON manifest files where type safety is not guaranteed.
 *
 * @param value - Value to check
 * @returns true if value matches IssueRecord structure
 */
export function isIssueRecord(value: unknown): value is IssueRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  // Required string fields
  if (typeof record.agent_name !== 'string' || record.agent_name.length === 0) {
    return false;
  }
  if (typeof record.title !== 'string' || record.title.length === 0) {
    return false;
  }
  if (typeof record.description !== 'string' || record.description.length === 0) {
    return false;
  }
  if (typeof record.timestamp !== 'string' || record.timestamp.length === 0) {
    return false;
  }

  // Scope validation
  if (record.scope !== 'in-scope' && record.scope !== 'out-of-scope') {
    return false;
  }

  // Priority validation
  if (record.priority !== 'high' && record.priority !== 'low') {
    return false;
  }

  // Optional fields - validate type if present
  if (record.location !== undefined && typeof record.location !== 'string') {
    return false;
  }
  if (record.existing_todo !== undefined) {
    if (typeof record.existing_todo !== 'object' || record.existing_todo === null) {
      return false;
    }
    const todo = record.existing_todo as Record<string, unknown>;
    if (typeof todo.has_todo !== 'boolean') {
      return false;
    }
    if (todo.issue_reference !== undefined && typeof todo.issue_reference !== 'string') {
      return false;
    }
  }
  if (
    record.metadata !== undefined &&
    (typeof record.metadata !== 'object' || record.metadata === null)
  ) {
    return false;
  }

  return true;
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
