/**
 * Tool: wiggum_list_issues
 *
 * Returns a minimal list of issue references without full details.
 * This prevents token waste in the main thread by only showing IDs, titles, and metadata.
 * The main thread can then pass issue IDs to subagents who call wiggum_get_issue to get full details.
 *
 * Returns issue references with counts for filtering and tracking.
 *
 * ERROR HANDLING STRATEGY:
 * - VALIDATION ERRORS: Invalid scope parameter
 * - LOGGED ERRORS: File system errors (returns empty list with warning)
 * - STRUCTURED LOGGING: Issue listing, counts, filtering
 */

import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types.js';
import type { IssueRecord, IssueScope } from './manifest-types.js';
import {
  getManifestDir,
  isManifestFile,
  readManifestFile,
  extractScopeFromFilename,
} from './manifest-utils.js';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

// Zod schema for input validation
export const ListIssuesInputSchema = z.object({
  scope: z.enum(['in-scope', 'out-of-scope', 'all']).optional().default('all'),
});

export type ListIssuesInput = z.infer<typeof ListIssuesInputSchema>;

/**
 * Minimal issue reference returned to main thread
 * Full details can be retrieved via wiggum_get_issue
 */
export interface IssueReference {
  readonly id: string; // Unique identifier: "{agent}-{scope}-{index}"
  readonly agent_name: string;
  readonly scope: IssueScope;
  readonly priority: 'high' | 'low';
  readonly title: string; // Just the title, not full description
}

/**
 * Result with issue references and counts
 */
export interface ListIssuesResult {
  readonly issues: readonly IssueReference[];
  readonly counts: {
    readonly in_scope: number;
    readonly out_of_scope: number;
    readonly high_priority: number;
    readonly low_priority: number;
  };
}

/**
 * Read all manifest files matching the scope filter and return minimal references
 */
function listManifestIssues(scope: 'in-scope' | 'out-of-scope' | 'all'): IssueReference[] {
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

  logger.info('Found manifest files for listing', {
    totalFiles: files.length,
    matchingFiles: matchingFiles.length,
    scope,
  });

  // Read and create minimal references
  const issueReferences: IssueReference[] = [];
  const issuesByAgent = new Map<string, IssueRecord[]>();

  // First, group all issues by agent name and scope
  for (const filename of matchingFiles) {
    const filepath = join(manifestDir, filename);
    const issues = readManifestFile(filepath);

    for (const issue of issues) {
      const key = `${issue.agent_name}-${issue.scope}`;
      if (!issuesByAgent.has(key)) {
        issuesByAgent.set(key, []);
      }
      issuesByAgent.get(key)!.push(issue);
    }
  }

  // Now create issue references with stable IDs
  for (const [key, issues] of issuesByAgent) {
    issues.forEach((issue, index) => {
      issueReferences.push({
        id: `${key}-${index}`,
        agent_name: issue.agent_name,
        scope: issue.scope,
        priority: issue.priority,
        title: issue.title,
      });
    });
  }

  logger.info('Listed issue references', {
    totalReferences: issueReferences.length,
    scope,
  });

  return issueReferences;
}

/**
 * Calculate counts from issue references
 */
function calculateCounts(issues: readonly IssueReference[]): ListIssuesResult['counts'] {
  return {
    in_scope: issues.filter((i) => i.scope === 'in-scope').length,
    out_of_scope: issues.filter((i) => i.scope === 'out-of-scope').length,
    high_priority: issues.filter((i) => i.priority === 'high').length,
    low_priority: issues.filter((i) => i.priority === 'low').length,
  };
}

/**
 * Format result as text output
 */
function formatResult(result: ListIssuesResult, scope: string): string {
  if (result.issues.length === 0) {
    return `No issues found for scope: ${scope}`;
  }

  const { counts } = result;

  let output = `# Issue References (scope: ${scope})

## Counts
- **Total:** ${result.issues.length}
- **In-Scope:** ${counts.in_scope}
- **Out-of-Scope:** ${counts.out_of_scope}
- **High Priority:** ${counts.high_priority}
- **Low Priority:** ${counts.low_priority}

## Issue References

`;

  // Group by agent
  const issuesByAgent = new Map<string, IssueReference[]>();
  for (const issue of result.issues) {
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

      output += `- **${priorityEmoji} ${scopeLabel}** [${issue.id}] ${issue.title}\n`;
    }

    output += '\n';
  }

  output += `\n---

**Next steps:**
- For in-scope issues: Call unsupervised-implement agent with \`issue_id\` (ONE AT A TIME, sequential)
- For out-of-scope issues: Call out-of-scope-tracker agent with \`issue_id\` (ALL IN PARALLEL)
- Each agent will call \`wiggum_get_issue({ id })\` to get full details
`;

  return output;
}

/**
 * List all issues as minimal references
 */
export async function listIssues(input: ListIssuesInput): Promise<ToolResult> {
  logger.info('wiggum_list_issues', {
    scope: input.scope,
  });

  // Get minimal issue references
  const issues = listManifestIssues(input.scope);

  // Calculate counts
  const counts = calculateCounts(issues);

  // Create result
  const result: ListIssuesResult = {
    issues,
    counts,
  };

  // Format output
  const output = formatResult(result, input.scope);

  return {
    content: [{ type: 'text', text: output }],
  };
}
