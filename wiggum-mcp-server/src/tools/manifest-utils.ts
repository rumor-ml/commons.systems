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
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import type {
  IssueRecord,
  AgentManifest,
  IssueScope,
  ManifestFilenameComponents,
} from './manifest-types.js';
import { isIssueRecordArray } from './manifest-types.js';

// Re-export types for consumers that import from manifest-utils
export type { IssueRecord, AgentManifest, IssueScope, ManifestFilenameComponents };
export { isIssueRecord, isIssueRecordArray } from './manifest-types.js';

/**
 * All review agent names
 * Used to filter agents by completion status
 */
export const REVIEW_AGENT_NAMES = [
  'code-reviewer',
  'silent-failure-hunter',
  'code-simplifier',
  'comment-analyzer',
  'pr-test-analyzer',
  'type-design-analyzer',
] as const;

/**
 * Get manifest directory path
 *
 * Returns the path to the manifest directory: $(pwd)/tmp/wiggum/
 * This is where all manifest JSON files are stored.
 *
 * NOTE: This function does NOT create the directory. Use getOrCreateManifestDir()
 * from record-review-issue.ts if you need to ensure the directory exists.
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
 * Valid patterns:
 * - {agent-name}-in-scope-{timestamp}-{random}.json
 * - {agent-name}-out-of-scope-{timestamp}-{random}.json
 *
 * CRITICAL: Both conditions (JSON extension AND scope marker) must be met.
 * The parentheses around the OR expression ensure .json is required for BOTH
 * scope patterns. Without proper parentheses, operator precedence would cause
 * the condition to incorrectly match non-JSON files containing '-out-of-scope-'.
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
 * - ENOENT (file not found): DEBUG level, acceptable - agent may not have run yet
 * - EACCES/EROFS (permission errors): ERROR level - indicates filesystem issue
 * - JSON parse errors: ERROR level - indicates manifest corruption
 * - Schema validation errors: ERROR level - indicates format mismatch
 * - Other errors: WARN level with full diagnostics
 *
 * Returns empty array on failure to allow workflow to continue with partial data.
 *
 * @param filepath - Full path to the manifest file
 * @returns Array of IssueRecords, or empty array on failure
 */
export function readManifestFile(filepath: string): IssueRecord[] {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      // ERROR level - schema violation indicates corruption or format change
      logger.error('Manifest file is not an array - data corruption or format violation', {
        filepath,
        actualType: typeof parsed,
        impact: 'Agent completion tracking may be incorrect',
      });
      return [];
    }

    // Validate each issue record has the expected structure
    if (!isIssueRecordArray(parsed)) {
      logger.error('Manifest file contains invalid issue records - schema validation failed', {
        filepath,
        issueCount: parsed.length,
        impact: 'Some or all issues may have invalid structure',
        suggestion: 'Check manifest file format matches IssueRecord interface',
      });
      // Return empty to prevent downstream errors from malformed data
      return [];
    }

    return parsed;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode = (error as NodeJS.ErrnoException).code;

    // File not found is acceptable - agent may not have completed yet
    if (errorCode === 'ENOENT') {
      logger.debug('Manifest file does not exist - agent may not have completed yet', {
        filepath,
      });
      return [];
    }

    // Permission errors indicate filesystem issues that should be escalated
    if (errorCode === 'EACCES' || errorCode === 'EROFS') {
      logger.error('Cannot read manifest file due to filesystem permission error', {
        filepath,
        errorCode,
        error: errorMsg,
        impact: 'Agent completion tracking will be incorrect',
        suggestion: 'Check file permissions on tmp/wiggum directory',
      });
      return [];
    }

    // JSON parse errors indicate corruption
    if (error instanceof SyntaxError) {
      logger.error('Failed to parse manifest file - JSON is malformed or corrupt', {
        filepath,
        error: errorMsg,
        impact: 'Review issues from this agent will be lost',
        suggestion: 'Check if file was partially written or truncated',
      });
      return [];
    }

    // Other errors - log with full context
    logger.warn('Failed to read manifest file - unexpected error', {
      filepath,
      errorCode,
      error: errorMsg,
      errorStack: error instanceof Error ? error.stack : undefined,
      impact: 'Agent completion tracking may be affected',
    });
    return [];
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
      const highPriorityCount = mergedIssues.filter((i) => i.priority === 'high').length;

      agentManifests.set(key, {
        agent_name: parsed.agentName,
        scope: parsed.scope,
        issues: mergedIssues,
        high_priority_count: highPriorityCount,
      });
    } else {
      const highPriorityCount = issues.filter((i) => i.priority === 'high').length;

      agentManifests.set(key, {
        agent_name: parsed.agentName,
        scope: parsed.scope,
        issues,
        high_priority_count: highPriorityCount,
      });
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
 * Determine which agents should be marked complete
 *
 * An agent is complete if:
 * 1. No in-scope manifest exists (found zero issues), OR
 * 2. Has in-scope manifest but zero high-priority issues
 *
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
 * Delete all manifest files in the manifest directory
 * Called after processing manifests to clean up for next iteration
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

  // Delete all JSON manifest files
  for (const filename of files) {
    if (filename.endsWith('.json')) {
      const filepath = join(manifestDir, filename);
      try {
        unlinkSync(filepath);
        deletedCount++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to delete manifest file - continuing', {
          filepath,
          error: errorMsg,
        });
      }
    }
  }

  logger.info('Cleaned up manifest files', {
    totalFiles: files.length,
    deletedCount,
    path: manifestDir,
  });
}
