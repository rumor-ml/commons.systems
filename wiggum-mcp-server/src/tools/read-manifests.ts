/**
 * Tool: wiggum_read_manifests
 *
 * Reads and aggregates review issue manifest files based on scope filter.
 * Globs for matching JSON files in $(pwd)/tmp/wiggum/ directory and returns aggregated data.
 *
 * This tool uses shared utilities from manifest-utils.ts to avoid code duplication
 * and ensure consistent behavior across all manifest operations.
 *
 * ERROR HANDLING STRATEGY:
 * - VALIDATION ERRORS: Invalid scope parameter
 * - LOGGED ERRORS: File system errors, JSON parsing errors (skipped with warning)
 * - STRUCTURED LOGGING: Manifest reading, parsing errors, aggregation results
 */

import { z } from 'zod';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types.js';
import type { IssueRecord, ManifestSummary } from './manifest-types.js';
import { createManifestSummary } from './manifest-types.js';
import {
  getManifestDir,
  isManifestFile,
  readManifestFile,
  extractScopeFromFilename,
} from './manifest-utils.js';

// Zod schema for input validation
export const ReadManifestsInputSchema = z.object({
  scope: z.enum(['in-scope', 'out-of-scope', 'all'], {
    errorMap: () => ({ message: 'scope must be "in-scope", "out-of-scope", or "all"' }),
  }),
});

export type ReadManifestsInput = z.infer<typeof ReadManifestsInputSchema>;

/**
 * Read all manifest files matching the scope filter
 */
function readManifestFiles(scope: 'in-scope' | 'out-of-scope' | 'all'): IssueRecord[] {
  const manifestDir = getManifestDir();

  // Check if directory exists
  if (!existsSync(manifestDir)) {
    logger.info('Manifest directory does not exist - no issues recorded yet', {
      path: manifestDir,
    });
    return [];
  }

  // Read all files in directory
  const files = readdirSync(manifestDir);

  // Filter manifest files by scope
  const matchingFiles = files.filter((filename) => {
    if (!isManifestFile(filename)) {
      return false;
    }

    if (scope === 'all') {
      return true;
    }

    const fileScope = extractScopeFromFilename(filename);
    return fileScope === scope;
  });

  logger.info('Found manifest files', {
    totalFiles: files.length,
    matchingFiles: matchingFiles.length,
    scope,
  });

  // Read and aggregate all matching files
  const allIssues: IssueRecord[] = [];
  let filesRead = 0;
  let filesSkipped = 0;

  for (const filename of matchingFiles) {
    const filepath = join(manifestDir, filename);
    const issues = readManifestFile(filepath);

    if (issues.length > 0) {
      allIssues.push(...issues);
      filesRead++;
    } else {
      filesSkipped++;
    }
  }

  logger.info('Aggregated manifest data', {
    filesRead,
    filesSkipped,
    totalIssues: allIssues.length,
    scope,
  });

  return allIssues;
}

/**
 * Calculate summary statistics from issues
 *
 * Uses the createManifestSummary factory to ensure invariant validation:
 * - total_issues === in_scope_count + out_of_scope_count
 * - total_issues === high_priority_count + low_priority_count
 * - agents_with_issues is sorted and unique
 */
function calculateSummary(issues: readonly IssueRecord[]): ManifestSummary {
  return createManifestSummary(issues);
}

/**
 * Format summary as text output
 */
function formatSummary(summary: ManifestSummary, scope: string): string {
  if (summary.total_issues === 0) {
    return `No issues found for scope: ${scope}`;
  }

  let output = `# Review Issues Summary (scope: ${scope})

## Statistics
- **Total Issues:** ${summary.total_issues}
- **High Priority:** ${summary.high_priority_count}
- **Low Priority:** ${summary.low_priority_count}
- **In-Scope:** ${summary.in_scope_count}
- **Out-of-Scope:** ${summary.out_of_scope_count}

## Agents with Issues
${summary.agents_with_issues.map((agent) => `- ${agent}`).join('\n')}

## Issues by Agent

`;

  // Group issues by agent
  const issuesByAgent = new Map<string, IssueRecord[]>();
  for (const issue of summary.issues) {
    if (!issuesByAgent.has(issue.agent_name)) {
      issuesByAgent.set(issue.agent_name, []);
    }
    issuesByAgent.get(issue.agent_name)!.push(issue);
  }

  // Format each agent's issues
  for (const [agentName, issues] of issuesByAgent) {
    output += `### ${agentName} (${issues.length} issue${issues.length !== 1 ? 's' : ''})\n\n`;

    for (const issue of issues) {
      const priorityEmoji = issue.priority === 'high' ? '🔴' : '🔵';
      const scopeLabel = issue.scope === 'in-scope' ? 'In-Scope' : 'Out-of-Scope';

      output += `#### ${priorityEmoji} ${scopeLabel} - ${issue.title}\n\n`;
      output += `${issue.description}\n\n`;

      if (issue.location) {
        output += `**Location:** ${issue.location}\n\n`;
      }

      if (issue.existing_todo) {
        output += `**Existing TODO:** ${issue.existing_todo.has_todo ? `Yes (${issue.existing_todo.issue_reference || 'no reference'})` : 'No'}\n\n`;
      }

      if (issue.metadata && Object.keys(issue.metadata).length > 0) {
        output += `**Metadata:**\n\`\`\`json\n${JSON.stringify(issue.metadata, null, 2)}\n\`\`\`\n\n`;
      }

      output += `---\n\n`;
    }
  }

  return output;
}

/**
 * Read and aggregate manifest files
 */
export async function readManifests(input: ReadManifestsInput): Promise<ToolResult> {
  logger.info('wiggum_read_manifests', {
    scope: input.scope,
  });

  // Read manifests
  const issues = readManifestFiles(input.scope);

  // Calculate summary
  const summary = calculateSummary(issues);

  // Format output
  const output = formatSummary(summary, input.scope);

  return {
    content: [{ type: 'text', text: output }],
  };
}
