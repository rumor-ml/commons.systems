/**
 * Tool: wiggum_get_issue
 *
 * Retrieves full details for a single issue by ID.
 * Used by subagents to get the complete issue information they need to work on.
 *
 * Issue ID format: {agent-name}-{scope}-{index}
 * Example: "code-reviewer-in-scope-0"
 *
 * ERROR HANDLING STRATEGY:
 * - VALIDATION ERRORS: Invalid ID format, issue not found
 * - LOGGED ERRORS: File system errors, JSON parsing errors
 * - STRUCTURED LOGGING: Issue retrieval, ID parsing
 */

import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import type { IssueRecord, IssueScope } from './manifest-types.js';
import { getManifestDir, isManifestFile, readManifestFile } from './manifest-utils.js';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

// Zod schema for input validation
export const GetIssueInputSchema = z.object({
  id: z.string().min(1, 'id cannot be empty'),
});

export type GetIssueInput = z.infer<typeof GetIssueInputSchema>;

/**
 * Full issue details returned to subagent
 */
export interface IssueDetails {
  readonly id: string;
  readonly agent_name: string;
  readonly scope: IssueScope;
  readonly priority: 'high' | 'low';
  readonly title: string;
  readonly description: string;
  readonly location?: string;
  readonly existing_todo?: {
    readonly has_todo: boolean;
    readonly issue_reference?: string;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Parse issue ID into components
 * Format: {agent-name}-{scope}-{index}
 * Example: "code-reviewer-in-scope-0"
 */
function parseIssueId(id: string): {
  agentName: string;
  scope: IssueScope;
  index: number;
} | null {
  // Extract scope first
  let scope: IssueScope;
  let scopeMarker: string;

  if (id.includes('-in-scope-')) {
    scope = 'in-scope';
    scopeMarker = '-in-scope-';
  } else if (id.includes('-out-of-scope-')) {
    scope = 'out-of-scope';
    scopeMarker = '-out-of-scope-';
  } else {
    return null;
  }

  // Split by scope marker
  const parts = id.split(scopeMarker);
  if (parts.length !== 2) {
    return null;
  }

  const agentName = parts[0];
  const indexStr = parts[1];

  // Parse index
  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 0) {
    return null;
  }

  return { agentName, scope, index };
}

/**
 * Extract scope from manifest filename
 */
function extractScopeFromFilename(filename: string): IssueScope | undefined {
  if (filename.includes('-in-scope-')) {
    return 'in-scope';
  }
  if (filename.includes('-out-of-scope-')) {
    return 'out-of-scope';
  }
  return undefined;
}

/**
 * Find and return a specific issue by ID
 */
function findIssueById(id: string): IssueDetails | null {
  // Parse the ID
  const parsed = parseIssueId(id);
  if (!parsed) {
    logger.warn('Invalid issue ID format', { id });
    return null;
  }

  const { agentName, scope, index } = parsed;

  const manifestDir = getManifestDir();

  // Check if directory exists
  if (!existsSync(manifestDir)) {
    logger.info('Manifest directory does not exist - no issues recorded yet', {
      path: manifestDir,
    });
    return null;
  }

  // Read all files in directory
  const files = readdirSync(manifestDir);

  // Filter manifest files by agent and scope
  const matchingFiles = files.filter((filename) => {
    if (!isManifestFile(filename)) {
      return false;
    }

    const fileScope = extractScopeFromFilename(filename);
    if (fileScope !== scope) {
      return false;
    }

    // Check if filename starts with agent name
    const sanitizedAgentName = agentName.replace(/[^a-zA-Z0-9-]/g, '-');
    return filename.startsWith(`${sanitizedAgentName}-${scope}-`);
  });

  logger.info('Found matching manifest files', {
    id,
    agentName,
    scope,
    index,
    matchingFiles: matchingFiles.length,
  });

  // Collect all issues from matching files
  const allIssues: IssueRecord[] = [];
  for (const filename of matchingFiles) {
    const filepath = join(manifestDir, filename);
    const issues = readManifestFile(filepath);
    allIssues.push(...issues);
  }

  // Get the issue at the specified index
  if (index >= allIssues.length) {
    logger.warn('Issue index out of range', {
      id,
      index,
      totalIssues: allIssues.length,
    });
    return null;
  }

  const issue = allIssues[index];

  // Convert to IssueDetails
  const details: IssueDetails = {
    id,
    agent_name: issue.agent_name,
    scope: issue.scope,
    priority: issue.priority,
    title: issue.title,
    description: issue.description,
    location: issue.location,
    existing_todo: issue.existing_todo,
    metadata: issue.metadata,
  };

  logger.info('Retrieved issue details', {
    id,
    agentName: details.agent_name,
    scope: details.scope,
    priority: details.priority,
  });

  return details;
}

/**
 * Format issue details as text output
 */
function formatIssueDetails(details: IssueDetails): string {
  const priorityEmoji = details.priority === 'high' ? '🔴' : '🔵';
  const scopeLabel = details.scope === 'in-scope' ? 'In-Scope' : 'Out-of-Scope';

  let output = `# ${priorityEmoji} ${scopeLabel} Issue

**ID:** ${details.id}
**Agent:** ${details.agent_name}
**Priority:** ${details.priority}

## Title
${details.title}

## Description
${details.description}

`;

  if (details.location) {
    output += `## Location
${details.location}

`;
  }

  if (details.existing_todo) {
    output += `## Existing TODO
- **Has TODO:** ${details.existing_todo.has_todo ? 'Yes' : 'No'}
`;
    if (details.existing_todo.issue_reference) {
      output += `- **Issue Reference:** ${details.existing_todo.issue_reference}\n`;
    }
    output += '\n';
  }

  if (details.metadata && Object.keys(details.metadata).length > 0) {
    output += `## Metadata
\`\`\`json
${JSON.stringify(details.metadata, null, 2)}
\`\`\`

`;
  }

  return output;
}

/**
 * Get full details for a single issue
 */
export async function getIssue(input: GetIssueInput): Promise<ToolResult> {
  logger.info('wiggum_get_issue', {
    id: input.id,
  });

  // Find the issue
  const details = findIssueById(input.id);

  if (!details) {
    throw new ValidationError(
      `Issue not found: ${input.id}. ` +
        `Make sure the ID format is correct (e.g., "code-reviewer-in-scope-0") ` +
        `and the issue exists in the manifest files.`
    );
  }

  // Format output
  const output = formatIssueDetails(details);

  return {
    content: [{ type: 'text', text: output }],
  };
}
