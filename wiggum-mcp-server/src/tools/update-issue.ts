/**
 * Tool: wiggum_update_issue
 *
 * Updates fields on an existing issue in the manifest files.
 * Currently supports updating the `already_fixed` field to mark issues as already fixed.
 *
 * Issue ID format: {agent-name}-{scope}-{index}
 * Example: "code-reviewer-in-scope-0"
 *
 * ERROR HANDLING STRATEGY:
 * - VALIDATION ERRORS: Invalid ID format, issue not found
 * - LOGGED ERRORS: File system errors, JSON parsing errors
 * - STRUCTURED LOGGING: Issue update operations
 */

import { z } from 'zod';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { ValidationError, FilesystemError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import type { IssueRecord, IssueScope } from './manifest-types.js';
import { getManifestDir, isManifestFile, extractScopeFromFilename } from './manifest-utils.js';

// Zod schema for input validation
export const UpdateIssueInputSchema = z.object({
  id: z.string().min(1, 'id cannot be empty'),
  already_fixed: z.boolean(),
});

export type UpdateIssueInput = z.infer<typeof UpdateIssueInputSchema>;

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
 * Update an issue's already_fixed field in the manifest files
 */
export async function updateIssue(input: UpdateIssueInput): Promise<ToolResult> {
  logger.info('wiggum_update_issue', {
    id: input.id,
    already_fixed: input.already_fixed,
  });

  // Parse the ID
  const parsed = parseIssueId(input.id);
  if (!parsed) {
    throw new ValidationError(
      `Invalid issue ID format: ${input.id}. ` +
        `Expected format: {agent-name}-{scope}-{index} (e.g., "code-reviewer-in-scope-0")`
    );
  }

  const { agentName, scope, index } = parsed;

  const manifestDir = getManifestDir();

  // Check if directory exists
  if (!existsSync(manifestDir)) {
    throw new ValidationError(
      `Manifest directory does not exist: ${manifestDir}. ` + `No issues have been recorded yet.`
    );
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

  if (matchingFiles.length === 0) {
    throw new ValidationError(
      `No manifest files found for agent "${agentName}" with scope "${scope}". ` +
        `Issue ID: ${input.id}`
    );
  }

  logger.info('Found matching manifest files', {
    id: input.id,
    agentName,
    scope,
    index,
    matchingFiles: matchingFiles.length,
  });

  // Collect all issues from matching files to find the target issue
  let issueIndex = 0;
  let targetFilePath: string | undefined;
  let targetIssueIndexInFile: number | undefined;

  for (const filename of matchingFiles) {
    const filepath = join(manifestDir, filename);

    let issues: IssueRecord[];
    try {
      const content = readFileSync(filepath, 'utf-8');
      issues = JSON.parse(content);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to read manifest file', {
        filepath,
        error: errorMsg,
      });
      throw new FilesystemError(
        `Failed to read manifest file ${filepath}: ${errorMsg}`,
        filepath,
        error instanceof Error ? error : new Error(errorMsg)
      );
    }

    // Check if the target issue is in this file
    for (let i = 0; i < issues.length; i++) {
      if (issueIndex === index) {
        // Found the target issue
        targetFilePath = filepath;
        targetIssueIndexInFile = i;
        break;
      }
      issueIndex++;
    }

    if (targetFilePath) {
      break;
    }
  }

  if (!targetFilePath || targetIssueIndexInFile === undefined) {
    throw new ValidationError(
      `Issue not found: ${input.id}. ` +
        `Index ${index} is out of range (found ${issueIndex} total issues).`
    );
  }

  // Read the target file and update the issue
  try {
    const content = readFileSync(targetFilePath, 'utf-8');
    const issues: IssueRecord[] = JSON.parse(content);

    // Update the issue
    const originalIssue = issues[targetIssueIndexInFile];
    const updatedIssue: IssueRecord = {
      ...originalIssue,
      already_fixed: input.already_fixed,
    };
    issues[targetIssueIndexInFile] = updatedIssue;

    // Write back to file
    writeFileSync(targetFilePath, JSON.stringify(issues, null, 2), 'utf-8');

    logger.info('Updated issue in manifest', {
      id: input.id,
      filepath: targetFilePath,
      issueIndexInFile: targetIssueIndexInFile,
      already_fixed: input.already_fixed,
      title: originalIssue.title,
    });

    const message = `✅ Updated issue: ${input.id}

**Title:** ${originalIssue.title}
**Agent:** ${originalIssue.agent_name}
**Scope:** ${originalIssue.scope}
**Priority:** ${originalIssue.priority}

**Changes:**
- \`already_fixed\`: ${originalIssue.already_fixed ?? false} → ${input.already_fixed}

Issue updated in: ${targetFilePath}`;

    return {
      content: [{ type: 'text', text: message }],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode = (error as NodeJS.ErrnoException).code;

    logger.error('Failed to update manifest file', {
      filepath: targetFilePath,
      error: errorMsg,
      errorCode,
    });

    throw new FilesystemError(
      `Failed to update manifest file ${targetFilePath}: ${errorMsg}`,
      targetFilePath,
      error instanceof Error ? error : new Error(errorMsg),
      undefined,
      errorCode
    );
  }
}
