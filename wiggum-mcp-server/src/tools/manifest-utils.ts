/**
 * Manifest file utilities for agent completion tracking
 *
 * Provides functions to read manifest files created by review agents
 * and determine which agents have completed their work (zero high-priority in-scope issues).
 *
 * This module exports shared utility functions used by:
 * - read-manifests.ts (reads and aggregates manifests by scope)
 * - record-review-issue.ts (writes issues to manifest files)
 *
 * Consolidation reduces code duplication and ensures consistent behavior
 * across all manifest operations.
 *
 * TODO(#987): Add performance tests for manifest file operations - test read/write scaling
 * with large issue counts, concurrent agent writes, and cleanup with many files.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { FilesystemError } from '../utils/errors.js';
import type {
  IssueRecord,
  AgentManifest,
  IssueScope,
  ManifestFilenameComponents,
  ReviewAgentName,
} from './manifest-types.js';
import {
  isIssueRecordArray,
  REVIEW_AGENT_NAME_VALUES,
  createAgentManifest,
} from './manifest-types.js';

// Re-export types for consumers that import from manifest-utils
export type { IssueRecord, AgentManifest, IssueScope, ManifestFilenameComponents, ReviewAgentName };
export {
  isIssueRecord,
  isIssueRecordArray,
  isReviewAgentName,
  createAgentManifest,
  AgentManifestInvariantError,
} from './manifest-types.js';

/**
 * All review agent names
 *
 * Re-exported from manifest-types.ts for backward compatibility.
 * Used to filter agents by completion status.
 *
 * @see ReviewAgentName for the corresponding type
 */
export const REVIEW_AGENT_NAMES: readonly ReviewAgentName[] = REVIEW_AGENT_NAME_VALUES;

/**
 * Get manifest directory path
 *
 * Returns the path to the manifest directory: $(pwd)/tmp/wiggum/
 * This is where all manifest JSON files are stored.
 *
 * NOTE: This function does NOT create the directory. The version in
 * record-review-issue.ts creates it on-demand during writes. For reading
 * operations, missing directory is acceptable (no manifests exist yet).
 *
 * @returns Absolute path to the manifest directory
 */
export function getManifestDir(): string {
  const cwd = process.cwd();
  return join(cwd, 'tmp', 'wiggum');
}

/**
 * Check if filename matches the manifest pattern
 *
 * Requires both .json extension AND scope marker (-in-scope- or -out-of-scope-).
 *
 * @param filename - Filename to check (not full path)
 * @returns true if filename matches the manifest pattern
 *
 * @example
 * isManifestFile('code-reviewer-in-scope-1234567890-abc123.json') // true
 * isManifestFile('code-reviewer-out-of-scope-1234567890-abc123.json') // true
 * isManifestFile('code-reviewer-in-scope-1234567890.bak') // false - not .json
 * isManifestFile('random-file.json') // false - no scope marker
 */
export function isManifestFile(filename: string): boolean {
  return (
    filename.endsWith('.json') &&
    (filename.includes('-in-scope-') || filename.includes('-out-of-scope-'))
  );
}

/**
 * Extract scope from manifest filename
 *
 * Helper function to determine if a file matches a specific scope.
 * Uses the filename pattern convention: {agent-name}-{scope}-{timestamp}-{random}.json
 *
 * This function is exported to avoid duplication in tools that need to filter
 * manifest files by scope without needing the full parsed components.
 *
 * @param filename - Filename to extract scope from (not full path)
 * @returns 'in-scope' or 'out-of-scope' if found, otherwise undefined
 *
 * @example
 * extractScopeFromFilename('code-reviewer-in-scope-1234567890-abc123.json')
 * // Returns: 'in-scope'
 *
 * extractScopeFromFilename('code-reviewer-out-of-scope-1234567890-abc123.json')
 * // Returns: 'out-of-scope'
 *
 * extractScopeFromFilename('random-file.json')
 * // Returns: undefined
 */
export function extractScopeFromFilename(filename: string): IssueScope | undefined {
  if (filename.includes('-in-scope-')) {
    return 'in-scope';
  }
  if (filename.includes('-out-of-scope-')) {
    return 'out-of-scope';
  }
  return undefined;
}

/**
 * Extract agent name and scope from manifest filename
 *
 * Parses the manifest filename pattern: {agent-name}-{scope}-{timestamp}-{random}.json
 *
 * @param filename - Filename to parse (not full path)
 * @returns Parsed components or null if filename doesn't match pattern
 *
 * @example
 * parseManifestFilename('code-reviewer-in-scope-1234567890-abc123.json')
 * // Returns: { agentName: 'code-reviewer', scope: 'in-scope' }
 *
 * parseManifestFilename('invalid-filename.json')
 * // Returns: null
 */
export function parseManifestFilename(filename: string): ManifestFilenameComponents | null {
  // Extract scope first
  let scope: IssueScope;
  if (filename.includes('-in-scope-')) {
    scope = 'in-scope';
  } else if (filename.includes('-out-of-scope-')) {
    scope = 'out-of-scope';
  } else {
    return null;
  }

  // Extract agent name (everything before -{scope}-)
  const scopeMarker = scope === 'in-scope' ? '-in-scope-' : '-out-of-scope-';
  const agentName = filename.split(scopeMarker)[0];

  if (!agentName) {
    return null;
  }

  return { agentName, scope };
}

/**
 * Read and parse a single manifest file
 *
 * Reads a JSON manifest file and validates its contents as an array of IssueRecords.
 * Uses runtime type validation via isIssueRecordArray to ensure data integrity.
 *
 * Error handling strategy:
 * - ENOENT (file not found): Returns empty array - agent may not have run yet
 * - All other errors: Throws FilesystemError to prevent silent data loss
 *   - EACCES/EROFS (permission errors): Critical filesystem issue
 *   - JSON parse errors: Manifest corruption (partial writes, disk errors)
 *   - Schema validation errors: Data format corruption
 *   - Other errors: Unexpected filesystem issues
 *
 * This function throws on errors (except ENOENT) because returning an empty array
 * would cause callers to incorrectly believe the agent found zero issues, leading to:
 * - Agents being incorrectly marked as complete
 * - Review findings being silently lost
 * - Workflow proceeding without critical feedback
 *
 * @param filepath - Full path to the manifest file
 * @returns Array of IssueRecords, or empty array if file does not exist
 * @throws {FilesystemError} If file exists but cannot be read or parsed correctly
 */
export function readManifestFile(filepath: string): IssueRecord[] {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      logger.error('Manifest file is not an array - data corruption detected', {
        filepath,
        actualType: typeof parsed,
        impact: 'Review data from this agent will be lost if not thrown',
      });
      throw new FilesystemError(
        `Manifest file ${filepath} is corrupted (expected array, got ${typeof parsed}). ` +
          `Review data from this agent cannot be recovered. ` +
          `Check for partial writes or disk errors.`,
        filepath,
        new Error(`Expected array, got ${typeof parsed}`)
      );
    }

    // Validate each issue record has the expected structure
    if (!isIssueRecordArray(parsed)) {
      logger.error('Manifest file contains invalid issue records - schema validation failed', {
        filepath,
        issueCount: parsed.length,
        impact: 'Review data structure is corrupt',
      });
      throw new FilesystemError(
        `Manifest file ${filepath} contains invalid issue records. ` +
          `Schema validation failed for IssueRecord[]. ` +
          `Check manifest file format.`,
        filepath,
        new Error('Schema validation failed for IssueRecord[]')
      );
    }

    return parsed;
  } catch (error) {
    // Re-throw FilesystemError from validation failures above
    if (error instanceof FilesystemError) {
      throw error;
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode = (error as NodeJS.ErrnoException).code;

    // File not found is acceptable - agent may not have completed yet
    if (errorCode === 'ENOENT') {
      logger.debug('Manifest file does not exist - agent may not have completed yet', {
        filepath,
      });
      return [];
    }

    // Permission errors indicate filesystem issues - must throw to prevent data loss
    if (errorCode === 'EACCES' || errorCode === 'EROFS') {
      logger.error('Cannot read manifest file due to filesystem permission error', {
        filepath,
        errorCode,
        error: errorMsg,
        impact: 'Review data will be lost if not thrown',
      });
      throw new FilesystemError(
        `Cannot read manifest file ${filepath} due to ${errorCode}. ` +
          `Review data from this agent cannot be accessed. ` +
          `Check file permissions on tmp/wiggum directory.`,
        filepath,
        error instanceof Error ? error : new Error(errorMsg),
        undefined,
        errorCode
      );
    }

    // JSON parse errors indicate corruption - must throw to prevent data loss
    if (error instanceof SyntaxError) {
      logger.error('Failed to parse manifest file - JSON is malformed', {
        filepath,
        error: errorMsg,
        impact: 'Review data is corrupted',
      });
      throw new FilesystemError(
        `Manifest file ${filepath} contains malformed JSON. ` +
          `Review data is corrupted. ` +
          `Check if file was partially written or truncated.`,
        filepath,
        error
      );
    }

    // Other unexpected errors - must throw to prevent silent data loss
    logger.error('Failed to read manifest file - unexpected error', {
      filepath,
      errorCode,
      error: errorMsg,
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    throw new FilesystemError(
      `Failed to read manifest file ${filepath}: ${errorMsg}. ` +
        `Review data from this agent cannot be accessed.`,
      filepath,
      error instanceof Error ? error : new Error(errorMsg),
      undefined,
      errorCode
    );
  }
}

/**
 * Read all manifest files and group by agent name
 * Returns a map of agent name to their manifest data
 */
export function readManifestFiles(): Map<string, AgentManifest> {
  const manifestDir = getManifestDir();
  const agentManifests = new Map<string, AgentManifest>();

  // Check if directory exists
  if (!existsSync(manifestDir)) {
    logger.info('Manifest directory does not exist - no issues recorded yet', {
      path: manifestDir,
    });
    return agentManifests;
  }

  // Read all files in directory
  const files = readdirSync(manifestDir);

  // Filter and process manifest files
  for (const filename of files) {
    if (!isManifestFile(filename)) {
      continue;
    }

    const parsed = parseManifestFilename(filename);
    if (!parsed) {
      logger.warn('Failed to parse manifest filename - skipping', { filename });
      continue;
    }

    const filepath = join(manifestDir, filename);
    const issues = readManifestFile(filepath);

    if (issues.length === 0) {
      continue;
    }

    // Create or update agent manifest
    const key = `${parsed.agentName}-${parsed.scope}`;
    const existingManifest = agentManifests.get(key);

    if (existingManifest) {
      // Merge issues from multiple files (shouldn't happen but handle it)
      const mergedIssues = [...existingManifest.issues, ...issues];
      agentManifests.set(key, createAgentManifest(parsed.agentName, parsed.scope, mergedIssues));
    } else {
      agentManifests.set(key, createAgentManifest(parsed.agentName, parsed.scope, issues));
    }
  }

  logger.info('Read manifest files', {
    totalFiles: files.length,
    manifestCount: agentManifests.size,
    agents: Array.from(agentManifests.keys()),
  });

  return agentManifests;
}

/**
 * Determine which agents should be marked complete (DEPRECATED - use updateAgentCompletionStatus)
 *
 * An agent is complete if:
 * 1. No in-scope manifest exists (found zero issues), OR
 * 2. Has in-scope manifest but zero high-priority issues
 *
 * @deprecated Use updateAgentCompletionStatus instead for 2-strike completion logic
 * @param manifests - Map of agent manifests from readManifestFiles
 * @returns Array of agent names that are complete
 */
export function getCompletedAgents(manifests: Map<string, AgentManifest>): string[] {
  const completedAgents: string[] = [];

  // Check each known review agent
  for (const agentName of REVIEW_AGENT_NAMES) {
    const inScopeKey = `${agentName}-in-scope`;
    const inScopeManifest = manifests.get(inScopeKey);

    // Agent is complete if no in-scope manifest OR no high-priority issues
    if (!inScopeManifest || inScopeManifest.high_priority_count === 0) {
      completedAgents.push(agentName);
      logger.info('Agent marked complete', {
        agentName,
        reason: !inScopeManifest ? 'no in-scope manifest' : 'zero high-priority in-scope issues',
        highPriorityCount: inScopeManifest?.high_priority_count ?? 0,
      });
    } else {
      logger.info('Agent still has work', {
        agentName,
        highPriorityCount: inScopeManifest.high_priority_count,
      });
    }
  }

  return completedAgents;
}

/**
 * Count total high-priority issues across all in-scope manifests
 *
 * This helper centralizes the logic for determining if there are any
 * high-priority in-scope issues remaining, which is used to decide
 * whether to advance to the next step or continue iteration.
 *
 * @param manifests - Map of agent manifests from readManifestFiles
 * @returns Total count of high-priority issues in all in-scope manifests
 *
 * @example
 * const manifests = readManifestFiles();
 * const count = countHighPriorityInScopeIssues(manifests);
 * if (count === 0) {
 *   // No high-priority issues - advance to next step
 * }
 */
export function countHighPriorityInScopeIssues(manifests: Map<string, AgentManifest>): number {
  let total = 0;
  for (const [key, manifest] of manifests.entries()) {
    if (key.endsWith('-in-scope')) {
      total += manifest.high_priority_count;
    }
  }
  return total;
}

/**
 * Update agent completion status using 2-strike verification logic
 *
 * Implements a 2-strike completion rule:
 * - First time agent finds 0 high-priority in-scope issues → "pending completion" (runs again)
 * - Second consecutive time → marked complete (stops running)
 * - If agent finds issues after being pending → reset to active (removed from both lists)
 *
 * This prevents false completions due to transient code states while still achieving
 * the optimization goal of skipping agents that have no more work to do.
 *
 * @param manifests - Map of agent manifests from readManifestFiles
 * @param previousPending - Array of agents pending completion from previous iteration
 * @param previousCompleted - Array of completed agents from previous iteration
 * @returns Object with completedAgents and pendingCompletionAgents arrays
 *
 * @example
 * // Run 1: agent finds 0 issues
 * updateAgentCompletionStatus(manifests, [], [])
 * // Returns: { completedAgents: [], pendingCompletionAgents: ['code-reviewer'] }
 *
 * // Run 2: agent still finds 0 issues
 * updateAgentCompletionStatus(manifests, ['code-reviewer'], [])
 * // Returns: { completedAgents: ['code-reviewer'], pendingCompletionAgents: [] }
 *
 * // Run 3: agent finds issues after being pending
 * updateAgentCompletionStatus(manifestsWithIssues, ['code-reviewer'], [])
 * // Returns: { completedAgents: [], pendingCompletionAgents: [] } // Reset to active
 */
export function updateAgentCompletionStatus(
  manifests: Map<string, AgentManifest>,
  previousPending: readonly string[],
  previousCompleted: readonly string[]
): { completedAgents: string[]; pendingCompletionAgents: string[] } {
  const completedAgents: string[] = [...previousCompleted];
  const pendingCompletionAgents: string[] = [];

  for (const agentName of REVIEW_AGENT_NAMES) {
    // Skip already completed agents (never revert completion)
    if (previousCompleted.includes(agentName)) {
      continue;
    }

    const inScopeManifest = manifests.get(`${agentName}-in-scope`);
    const hasHighPriorityIssues =
      inScopeManifest !== undefined && inScopeManifest.high_priority_count > 0;

    if (hasHighPriorityIssues) {
      // Agent found issues - reset any pending status
      // (implicitly not added to either list - back to active)
      logger.info('Agent has work - resetting pending status if any', {
        agentName,
        highPriorityCount: inScopeManifest.high_priority_count,
        wasPending: previousPending.includes(agentName),
      });
    } else if (previousPending.includes(agentName)) {
      // Second consecutive 0 → COMPLETE (2-strike verification passed)
      completedAgents.push(agentName);
      logger.info('Agent marked complete after 2-strike verification', {
        agentName,
        reason: '2nd consecutive iteration with zero high-priority issues',
        highPriorityCount: inScopeManifest?.high_priority_count ?? 0,
      });
    } else {
      // First time 0 → PENDING (needs verification)
      pendingCompletionAgents.push(agentName);
      logger.info('Agent pending completion - will verify next iteration', {
        agentName,
        reason: '1st iteration with zero high-priority issues',
        highPriorityCount: inScopeManifest?.high_priority_count ?? 0,
      });
    }
  }

  return { completedAgents, pendingCompletionAgents };
}

/**
 * Delete all manifest files in the manifest directory
 *
 * Called after processing manifests to clean up for next iteration.
 * Manifest cleanup is critical for workflow correctness - stale manifests
 * cause incorrect agent completion tracking.
 *
 * Error Handling:
 * - ENOENT: Acceptable - file may have been deleted by concurrent cleanup
 * - Other errors (EACCES, EBUSY, EROFS, EIO, etc.): Fatal - throws FilesystemError
 *
 * @throws {FilesystemError} If any manifest file cannot be deleted (non-ENOENT error)
 */
export async function cleanupManifestFiles(): Promise<void> {
  const manifestDir = getManifestDir();

  // Check if directory exists
  if (!existsSync(manifestDir)) {
    logger.info('Manifest directory does not exist - nothing to clean up', {
      path: manifestDir,
    });
    return;
  }

  // Read all files in directory
  const files = readdirSync(manifestDir);
  let deletedCount = 0;
  const failures: Array<{ filepath: string; error: string; errorCode?: string }> = [];

  // Delete all JSON manifest files
  for (const filename of files) {
    if (filename.endsWith('.json')) {
      const filepath = join(manifestDir, filename);
      try {
        unlinkSync(filepath);
        deletedCount++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorCode = (error as NodeJS.ErrnoException).code;

        // ENOENT is acceptable - file may have been deleted by another process
        if (errorCode === 'ENOENT') {
          logger.debug('Manifest file already deleted (concurrent cleanup)', { filepath });
          deletedCount++; // Count as success - file is gone
          continue;
        }

        // All other errors are critical - manifest cleanup is required for correctness
        failures.push({ filepath, error: errorMsg, errorCode });
        logger.error('Failed to delete manifest file - will halt cleanup', {
          filepath,
          errorCode,
          error: errorMsg,
          impact: 'Stale manifests will cause incorrect agent completion tracking',
        });
      }
    }
  }

  // If any deletions failed, throw to halt the workflow
  if (failures.length > 0) {
    logger.error('Manifest cleanup failed - halting workflow', {
      totalFiles: files.length,
      deletedCount,
      failedCount: failures.length,
      failures,
      path: manifestDir,
      impact: 'Workflow state will be corrupted by stale manifests',
    });

    throw new FilesystemError(
      `Failed to clean up ${failures.length} manifest file(s). ` +
        `Stale manifests will corrupt agent completion tracking. ` +
        `Check filesystem permissions and disk health. ` +
        `Failed files: ${failures.map((f) => f.filepath).join(', ')}`,
      manifestDir,
      new Error(failures.map((f) => f.error).join('; '))
    );
  }

  logger.info('Cleaned up manifest files', {
    totalFiles: files.length,
    deletedCount,
    path: manifestDir,
  });
}

/**
 * Safely clean up manifest files with non-fatal error handling
 *
 * Wraps cleanupManifestFiles() with try-catch to handle cleanup failures gracefully.
 * Cleanup failures are logged but do not throw - this is appropriate when:
 * - State has already been persisted to GitHub
 * - Workflow correctness doesn't depend on immediate cleanup
 * - Manual cleanup is acceptable as a fallback
 *
 * Use cleanupManifestFiles() directly if cleanup failure should halt the workflow.
 *
 * @returns Promise that always resolves (never throws)
 */
export async function safeCleanupManifestFiles(): Promise<void> {
  try {
    await cleanupManifestFiles();
  } catch (error) {
    logger.warn('Failed to clean up manifest files - continuing anyway', {
      error: error instanceof Error ? error.message : String(error),
      impact: 'Old manifest files may accumulate in tmp/wiggum',
      recommendation: 'Manually delete tmp/wiggum/*.json files if needed',
    });
  }
}
