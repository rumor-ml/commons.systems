/**
 * Tool: wiggum_read_manifests
 *
 * Reads and aggregates review issue manifest files based on scope filter.
 * Globs for matching JSON files in $(pwd)/tmp/wiggum/ directory and returns aggregated data.
 *
 * ERROR HANDLING STRATEGY:
 * - VALIDATION ERRORS: Invalid scope parameter
 * - LOGGED ERRORS: File system errors, JSON parsing errors (skipped with warning)
 * - STRUCTURED LOGGING: Manifest reading, parsing errors, aggregation results
 */

import { z } from 'zod';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types.js';

// Zod schema for input validation
export const ReadManifestsInputSchema = z.object({
  scope: z.enum(['in-scope', 'out-of-scope', 'all'], {
    errorMap: () => ({ message: 'scope must be "in-scope", "out-of-scope", or "all"' }),
  }),
});

export type ReadManifestsInput = z.infer<typeof ReadManifestsInputSchema>;

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
 * Aggregated manifest summary
 */
interface ManifestSummary {
  readonly total_issues: number;
  readonly high_priority_count: number;
  readonly low_priority_count: number;
  readonly in_scope_count: number;
  readonly out_of_scope_count: number;
  readonly agents_with_issues: readonly string[];
  readonly issues: readonly IssueRecord[];
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
    (filename.endsWith('.json') && filename.includes('-in-scope-')) ||
    filename.includes('-out-of-scope-')
  );
}

/**
 * Extract scope from manifest filename
 * Returns 'in-scope' or 'out-of-scope' if found in filename, otherwise undefined
 */
function extractScopeFromFilename(filename: string): 'in-scope' | 'out-of-scope' | undefined {
  if (filename.includes('-in-scope-')) {
    return 'in-scope';
  }
  if (filename.includes('-out-of-scope-')) {
    return 'out-of-scope';
  }
  return undefined;
}

/**
 * Read and parse a single manifest file
 * Returns array of issues or empty array if parsing fails
 */
function readManifestFile(filepath: string): IssueRecord[] {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const issues = JSON.parse(content);

    if (!Array.isArray(issues)) {
      logger.warn('Manifest file is not an array - skipping', {
        filepath,
        actualType: typeof issues,
      });
      return [];
    }

    return issues;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to read or parse manifest file - skipping', {
      filepath,
      error: errorMsg,
    });
    return [];
  }
}

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
 */
function calculateSummary(issues: readonly IssueRecord[]): ManifestSummary {
  const highPriorityCount = issues.filter((i) => i.priority === 'high').length;
  const lowPriorityCount = issues.filter((i) => i.priority === 'low').length;
  const inScopeCount = issues.filter((i) => i.scope === 'in-scope').length;
  const outOfScopeCount = issues.filter((i) => i.scope === 'out-of-scope').length;

  // Get unique agent names
  const agentSet = new Set<string>();
  for (const issue of issues) {
    agentSet.add(issue.agent_name);
  }
  const agents = Array.from(agentSet).sort();

  return {
    total_issues: issues.length,
    high_priority_count: highPriorityCount,
    low_priority_count: lowPriorityCount,
    in_scope_count: inScopeCount,
    out_of_scope_count: outOfScopeCount,
    agents_with_issues: agents,
    issues,
  };
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
        output += `**Existing TODO:** ${issue.existing_todo}\n\n`;
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
