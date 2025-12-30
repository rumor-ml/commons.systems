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
import {
  getManifestDir,
  isManifestFile,
  readManifestFile,
  extractScopeFromFilename,
  parseIssueId,
} from './manifest-utils.js';
import type { IssueReference } from './manifest-utils.js';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { batchInScopeIssues } from './list-issues.js';

// Zod schema for input validation
export const GetIssueInputSchema = z.union([
  z.object({
    id: z.string().min(1, 'id cannot be empty'),
  }),
  z.object({
    batch_id: z.string().min(1, 'batch_id cannot be empty'),
  }),
]);

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
  readonly files_to_edit?: readonly string[];
  readonly not_fixed?: boolean;
}

/**
 * Batch issue details returned when batch_id is provided
 */
export interface BatchIssueDetails {
  readonly batch_id: string;
  readonly files: readonly string[];
  readonly issues: readonly IssueDetails[];
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
    files_to_edit: issue.files_to_edit,
    not_fixed: issue.not_fixed,
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
 * Find and return all issues in a batch by batch_id
 * Batch ID format: "batch-{N}"
 */
async function findBatchById(batchId: string): Promise<BatchIssueDetails | null> {
  const manifestDir = getManifestDir();

  if (!existsSync(manifestDir)) {
    logger.info('Manifest directory does not exist - no batches available', {
      path: manifestDir,
    });
    return null;
  }

  // Read all in-scope manifest files
  const files = readdirSync(manifestDir);
  const inScopeFiles = files.filter((filename) => {
    if (!isManifestFile(filename)) {
      return false;
    }
    return extractScopeFromFilename(filename) === 'in-scope';
  });

  // Collect all in-scope issues
  const issuesByAgent = new Map<string, IssueRecord[]>();
  const allIssueRecords: IssueRecord[] = [];

  for (const filename of inScopeFiles) {
    const filepath = join(manifestDir, filename);
    const issues = readManifestFile(filepath);

    for (const issue of issues) {
      allIssueRecords.push(issue);
      const key = `${issue.agent_name}-${issue.scope}`;
      if (!issuesByAgent.has(key)) {
        issuesByAgent.set(key, []);
      }
      issuesByAgent.get(key)!.push(issue);
    }
  }

  // Create issue references with IDs
  const issueReferences: IssueReference[] = [];
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

  // Batch issues using the same algorithm as list-issues
  const batches = batchInScopeIssues(issueReferences, allIssueRecords);

  // Find the requested batch
  const batch = batches.find((b) => b.batch_id === batchId);

  if (!batch) {
    logger.warn('Batch not found', { batchId, availableBatches: batches.length });
    return null;
  }

  // Retrieve full details for all issues in the batch
  const issueDetails: IssueDetails[] = [];
  for (const issueId of batch.issue_ids) {
    const details = findIssueById(issueId);
    if (details) {
      issueDetails.push(details);
    }
  }

  return {
    batch_id: batch.batch_id,
    files: batch.files,
    issues: issueDetails,
  };
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
 * Format batch details as text output
 */
function formatBatchDetails(details: BatchIssueDetails): string {
  let output = `# Batch: ${details.batch_id}

**Files (${details.files.length}):**
`;

  for (const file of details.files) {
    output += `- ${file}\n`;
  }

  output += `\n**Issues (${details.issues.length}):**\n\n`;

  for (const issue of details.issues) {
    const priorityEmoji = issue.priority === 'high' ? '🔴' : '🔵';
    output += `---\n\n## ${priorityEmoji} [${issue.id}] ${issue.title}\n\n`;
    output += `**Agent:** ${issue.agent_name}\n`;
    output += `**Priority:** ${issue.priority}\n\n`;
    output += `${issue.description}\n\n`;

    if (issue.location) {
      output += `**Location:** ${issue.location}\n\n`;
    }
  }

  return output;
}

/**
 * Get full details for a single issue or batch
 */
export async function getIssue(input: GetIssueInput): Promise<ToolResult> {
  // Check if this is a batch request or single issue request
  if ('batch_id' in input) {
    logger.info('wiggum_get_issue (batch)', {
      batch_id: input.batch_id,
    });

    const batchDetails = await findBatchById(input.batch_id);

    if (!batchDetails) {
      throw new ValidationError(
        `Batch not found: ${input.batch_id}. ` +
          `Make sure the batch_id format is correct (e.g., "batch-0") ` +
          `and the batch exists in the manifest files.`
      );
    }

    const output = formatBatchDetails(batchDetails);

    return {
      content: [{ type: 'text', text: output }],
    };
  }

  // Single issue request
  logger.info('wiggum_get_issue', {
    id: input.id,
  });

  const details = findIssueById(input.id);

  if (!details) {
    throw new ValidationError(
      `Issue not found: ${input.id}. ` +
        `Make sure the ID format is correct (e.g., "code-reviewer-in-scope-0") ` +
        `and the issue exists in the manifest files.`
    );
  }

  const output = formatIssueDetails(details);

  return {
    content: [{ type: 'text', text: output }],
  };
}
