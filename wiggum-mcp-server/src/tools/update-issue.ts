/**
 * Tool: wiggum_update_issue
 *
 * Updates fields on an existing issue in the manifest files.
 * Currently supports updating the `not_fixed` field to exclude issues from high-priority counts.
 *
 * Use cases for marking issues as not_fixed:
 * - Issue was already fixed by another implementation in the same batch
 * - Issue is erroneous or inaccurate (reviewer misread the code)
 * - Implementation is intentional (design decision, not a bug)
 * - Issue doesn't apply to the current context
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
import type { IssueRecord } from './manifest-types.js';
import {
  getManifestDir,
  isManifestFile,
  extractScopeFromFilename,
  parseIssueId,
} from './manifest-utils.js';

// Zod schema for input validation
export const UpdateIssueInputSchema = z.object({
  id: z.string().min(1, 'id cannot be empty'),
  not_fixed: z.boolean(),
});

export type UpdateIssueInput = z.infer<typeof UpdateIssueInputSchema>;

/**
 * Get actionable guidance based on filesystem error code.
 * Exported for testing.
 */
export function getWriteErrorGuidance(errorCode: string | undefined, filePath: string): string {
  if (errorCode === 'ENOSPC') {
    return 'Disk is full. Free up space: df -h && du -sh /tmp/wiggum';
  } else if (errorCode === 'EACCES') {
    return `Permission denied. Check file permissions: ls -la ${filePath}`;
  } else if (errorCode === 'EROFS') {
    return 'Filesystem is read-only. Check mount options.';
  } else {
    return 'Check filesystem health and permissions.';
  }
}

/**
 * Update an issue's not_fixed field in the manifest files
 */
export async function updateIssue(input: UpdateIssueInput): Promise<ToolResult> {
  logger.info('wiggum_update_issue', {
    id: input.id,
    not_fixed: input.not_fixed,
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
    logger.error('Issue not found after searching all manifest files', {
      id: input.id,
      searchedFiles: matchingFiles,
      totalIssuesFound: issueIndex,
      requestedIndex: index,
    });
    throw new ValidationError(
      `Issue not found: ${input.id}. ` +
        `Index ${index} is out of range (found ${issueIndex} total issues across ${matchingFiles.length} files). ` +
        `Searched files: ${matchingFiles.join(', ')}`
    );
  }

  // Read the target file
  let content: string;
  try {
    content = readFileSync(targetFilePath, 'utf-8');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode = (error as NodeJS.ErrnoException).code;

    logger.error('Failed to READ manifest file for update', {
      filepath: targetFilePath,
      error: errorMsg,
      errorCode,
      operation: 'read',
    });

    throw new FilesystemError(
      `Failed to read manifest file ${targetFilePath} for update: ${errorMsg}. ` +
        `Issue update cannot proceed.`,
      targetFilePath,
      error instanceof Error ? error : new Error(errorMsg),
      undefined,
      errorCode
    );
  }

  // Parse the JSON content
  let issues: IssueRecord[];
  try {
    issues = JSON.parse(content);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error('Failed to PARSE manifest JSON for update', {
      filepath: targetFilePath,
      error: errorMsg,
      impact: 'Manifest file is corrupted',
    });

    throw new FilesystemError(
      `Manifest file ${targetFilePath} contains malformed JSON. ` +
        `Cannot update issue - file is corrupted. ` +
        `Parse error: ${errorMsg}`,
      targetFilePath,
      error instanceof Error ? error : new Error(errorMsg)
    );
  }

  // Update the issue (pure in-memory operation)
  const originalIssue = issues[targetIssueIndexInFile];
  const updatedIssue: IssueRecord = {
    ...originalIssue,
    not_fixed: input.not_fixed,
  };
  issues[targetIssueIndexInFile] = updatedIssue;

  // Write the updated content back to file
  try {
    writeFileSync(targetFilePath, JSON.stringify(issues, null, 2), 'utf-8');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode = (error as NodeJS.ErrnoException).code;

    // Get actionable guidance based on error code
    const errorGuidance = getWriteErrorGuidance(errorCode, targetFilePath);

    logger.error('Failed to WRITE updated manifest file', {
      filepath: targetFilePath,
      error: errorMsg,
      errorCode,
      operation: 'write',
      impact: 'Issue update failed but original data intact (read/parse succeeded)',
      guidance: errorGuidance,
    });

    throw new FilesystemError(
      `Failed to write updated manifest file ${targetFilePath}: ${errorMsg}. ` +
        `Original data is intact (read and parse succeeded). ` +
        errorGuidance,
      targetFilePath,
      error instanceof Error ? error : new Error(errorMsg),
      undefined,
      errorCode
    );
  }

  logger.info('Updated issue in manifest', {
    id: input.id,
    filepath: targetFilePath,
    issueIndexInFile: targetIssueIndexInFile,
    not_fixed: input.not_fixed,
    title: originalIssue.title,
  });

  const message = `Updated issue: ${input.id}

**Title:** ${originalIssue.title}
**Agent:** ${originalIssue.agent_name}
**Scope:** ${originalIssue.scope}
**Priority:** ${originalIssue.priority}

**Changes:**
- \`not_fixed\`: ${originalIssue.not_fixed ?? false} -> ${input.not_fixed}

Issue updated in: ${targetFilePath}`;

  return {
    content: [{ type: 'text', text: message }],
  };
}
