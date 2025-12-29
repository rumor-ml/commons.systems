/**
 * Manifest file utilities for agent completion tracking
 *
 * Provides functions to read manifest files created by review agents
 * and determine which agents have completed their work (zero high-priority in-scope issues).
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

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
 * Issue record from manifest files
 */
interface IssueRecord {
  readonly agent_name: string;
  readonly scope: 'in-scope' | 'out-of-scope';
  readonly priority: 'high' | 'low';
  readonly title: string;
  readonly description: string;
  readonly location?: string;
  readonly existing_todo?: string;
  readonly metadata?: Record<string, unknown>;
  readonly timestamp: string;
}

/**
 * Manifest summary by agent
 */
interface AgentManifest {
  readonly agent_name: string;
  readonly scope: 'in-scope' | 'out-of-scope';
  readonly issues: readonly IssueRecord[];
  readonly high_priority_count: number;
}

/**
 * Get manifest directory path
 */
function getManifestDir(): string {
  const cwd = process.cwd();
  return join(cwd, 'tmp', 'wiggum');
}

/**
 * Check if filename matches the manifest pattern
 * Pattern: {agent-name}-{scope}-{timestamp}-{random}.json
 */
function isManifestFile(filename: string): boolean {
  return (
    filename.endsWith('.json') &&
    (filename.includes('-in-scope-') || filename.includes('-out-of-scope-'))
  );
}

/**
 * Extract agent name and scope from manifest filename
 * Filename pattern: {agent-name}-{scope}-{timestamp}-{random}.json
 * Returns: { agentName: string, scope: 'in-scope' | 'out-of-scope' }
 */
function parseManifestFilename(
  filename: string
): { agentName: string; scope: 'in-scope' | 'out-of-scope' } | null {
  // Extract scope first
  let scope: 'in-scope' | 'out-of-scope';
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
 * Error handling strategy:
 * - ENOENT (file not found): DEBUG level, acceptable - agent may not have run yet
 * - EACCES/EROFS (permission errors): ERROR level - indicates filesystem issue
 * - JSON parse errors: ERROR level - indicates manifest corruption
 * - Other errors: WARN level with full diagnostics
 *
 * Returns empty array on failure to allow workflow to continue with partial data.
 */
function readManifestFile(filepath: string): IssueRecord[] {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const issues = JSON.parse(content);

    if (!Array.isArray(issues)) {
      // ERROR level - schema violation indicates corruption or format change
      logger.error('Manifest file is not an array - data corruption or format violation', {
        filepath,
        actualType: typeof issues,
        impact: 'Agent completion tracking may be incorrect',
      });
      return [];
    }

    return issues;
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
