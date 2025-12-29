/**
 * Tool: wiggum_record_review_issue
 *
 * Records a single review issue to the manifest file system and posts a GitHub comment.
 * Each call creates a new manifest file with a unique timestamp and random suffix to prevent
 * race conditions when multiple agents run concurrently.
 *
 * Manifest files are JSON arrays stored in: $(pwd)/tmp/wiggum/{agent-name}-{scope}-{timestamp}-{random}.json
 *
 * Phase detection determines comment posting target:
 * - Phase 1: Posts to the GitHub issue
 * - Phase 2: Posts to the PR
 *
 * This tool uses shared types from manifest-types.ts to ensure consistency
 * across all manifest operations.
 *
 * ERROR HANDLING STRATEGY:
 * - FULL SUCCESS: Both manifest write and GitHub comment succeed -> isError: false
 * - PARTIAL SUCCESS: One operation succeeds, one fails -> isError: true with _meta.partialSuccess
 *   - GITHUB_COMMENT_FAILED: Manifest written but comment failed (issue tracked but not visible)
 *   - MANIFEST_WRITE_FAILED: Comment posted but manifest failed (issue visible but not tracked)
 * - TOTAL FAILURE: Both operations fail -> throws ValidationError with recovery details
 *
 * The isError: true for partial success ensures callers are aware that something went wrong,
 * while _meta.partialSuccess indicates the operation was not a complete failure.
 */

import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { detectCurrentState } from '../state/detector.js';
import { postPRComment, sleep } from '../utils/gh-cli.js';
import { ghCli } from '../utils/gh-cli.js';
import { logger } from '../utils/logger.js';
import { FilesystemError, ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import type { IssueRecord } from './manifest-types.js';
import { ReviewAgentNameSchema } from './manifest-types.js';

/**
 * Known file extensions for validating auto-extracted file paths
 * Used to filter out descriptive strings that don't represent actual files
 */
const KNOWN_FILE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.go',
  '.py',
  '.java',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.svelte',
  '.rs',
  '.rb',
  '.php',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.swift',
  '.kt',
  '.scala',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.graphql',
  '.proto',
  '.xml',
  '.toml',
];

/**
 * Validate that a string looks like a file path
 *
 * Checks for:
 * 1. Non-empty string
 * 2. Contains path separator (/ or \)
 * 3. Has a known file extension
 * 4. No spaces (descriptive strings usually have spaces)
 *
 * This prevents descriptive location strings like "Multiple files" or
 * Windows drive letters like "C" from being treated as file paths.
 */
function looksLikeFilePath(value: string): boolean {
  if (!value || value.length === 0) {
    return false;
  }

  // Descriptive strings usually have spaces
  if (value.includes(' ')) {
    return false;
  }

  // Must have a path separator
  if (!value.includes('/') && !value.includes('\\')) {
    return false;
  }

  // Must end with a known file extension
  const lowerValue = value.toLowerCase();
  return KNOWN_FILE_EXTENSIONS.some((ext) => lowerValue.endsWith(ext));
}

// Zod schema for input validation
export const RecordReviewIssueInputSchema = z.object({
  agent_name: ReviewAgentNameSchema,
  scope: z.enum(['in-scope', 'out-of-scope'], {
    errorMap: () => ({ message: 'scope must be either "in-scope" or "out-of-scope"' }),
  }),
  priority: z.enum(['high', 'low'], {
    errorMap: () => ({ message: 'priority must be either "high" or "low"' }),
  }),
  title: z.string().min(1, 'title cannot be empty'),
  description: z.string().min(1, 'description cannot be empty'),
  location: z.string().optional(),
  existing_todo: z
    .object({
      has_todo: z.boolean(),
      issue_reference: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.unknown()).optional(),
  files_to_edit: z
    .array(z.string())
    .optional()
    .describe('Array of file paths this issue requires editing (for in-scope batching)'),
});

export type RecordReviewIssueInput = z.infer<typeof RecordReviewIssueInputSchema>;

/**
 * Generate a random suffix for filename collision prevention
 * Uses crypto.randomBytes for secure random generation
 */
function generateRandomSuffix(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Generate manifest filename based on agent, scope, and timestamp
 * Format: {agent-name}-{scope}-{timestamp}-{random}.json
 */
function generateManifestFilename(agentName: string, scope: string): string {
  const timestamp = Date.now();
  const random = generateRandomSuffix();
  const sanitizedAgentName = agentName.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${sanitizedAgentName}-${scope}-${timestamp}-${random}.json`;
}

/**
 * Get or create manifest directory
 * Creates $(pwd)/tmp/wiggum directory if it doesn't exist
 *
 * NOTE: This differs from getManifestDir() in manifest-utils.ts which only returns
 * the path without creating it. This function is used for write operations.
 */
function getOrCreateManifestDir(): string {
  const cwd = process.cwd();
  const manifestDir = join(cwd, 'tmp', 'wiggum');

  if (!existsSync(manifestDir)) {
    mkdirSync(manifestDir, { recursive: true });
    logger.info('Created manifest directory', { path: manifestDir });
  }

  return manifestDir;
}

/**
 * Write issue to a manifest file
 *
 * Creates a unique manifest file for each issue using timestamp + 4-byte random suffix.
 * This prevents race conditions when multiple agents run concurrently.
 *
 * NOTE: Each call creates a unique manifest file using timestamp + 4-byte random suffix,
 * making filename collisions astronomically unlikely (~1 in 4 billion per millisecond).
 *
 * The function is named "appendToManifest" because it conceptually appends to the set
 * of manifest files in the directory, not because it appends to an existing file.
 *
 * The defensive read-existing-content logic (lines 129-133) handles the theoretical
 * edge case of filename collision, but in practice this code path is never executed.
 */
function appendToManifest(issue: IssueRecord): string {
  const manifestDir = getOrCreateManifestDir();
  const filename = generateManifestFilename(issue.agent_name, issue.scope);
  const filepath = join(manifestDir, filename);

  try {
    // Read existing manifest or create new array
    let issues: IssueRecord[] = [];
    if (existsSync(filepath)) {
      const content = readFileSync(filepath, 'utf-8');
      issues = JSON.parse(content);
    }

    // Append new issue
    issues.push(issue);

    // Write back to file
    writeFileSync(filepath, JSON.stringify(issues, null, 2), 'utf-8');

    logger.info('Appended issue to manifest', {
      filepath,
      issueCount: issues.length,
      agentName: issue.agent_name,
      scope: issue.scope,
      priority: issue.priority,
    });

    return filepath;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode = (error as NodeJS.ErrnoException).code;

    // Classify error and provide specific guidance
    let errorMessage: string;

    if (errorCode === 'ENOSPC') {
      errorMessage =
        `Cannot write manifest file - disk is full: ${filepath}. ` +
        `Free up disk space and retry the operation.`;
    } else if (errorCode === 'EACCES') {
      errorMessage =
        `Cannot write manifest file - permission denied: ${filepath}. ` +
        `Ensure the process has write permissions to tmp/wiggum directory.`;
    } else if (errorCode === 'EROFS') {
      errorMessage =
        `Cannot write manifest file - filesystem is read-only: ${filepath}. ` +
        `This is a system configuration issue.`;
    } else if (error instanceof SyntaxError) {
      // JSON parse error when reading existing manifest
      errorMessage =
        `Cannot append to manifest - existing file is corrupted: ${filepath}. ` +
        `Parse error: ${errorMsg}. Delete the file and retry.`;
    } else {
      errorMessage =
        `Failed to write manifest file: ${errorMsg}. ` +
        `Ensure the tmp/wiggum directory exists and is writable.`;
    }

    logger.error('Failed to write manifest file', {
      filepath,
      error: errorMsg,
      errorCode,
      agentName: issue.agent_name,
      impact: 'Review issue will not be recorded',
    });

    throw new FilesystemError(
      errorMessage,
      filepath,
      error instanceof Error ? error : new Error(errorMsg),
      undefined,
      errorCode
    );
  }
}

/**
 * Format issue as GitHub comment markdown
 *
 * Exported for testing.
 */
export function formatIssueComment(issue: IssueRecord): string {
  const priorityEmoji = issue.priority === 'high' ? '🔴' : '🔵';
  const scopeLabel = issue.scope === 'in-scope' ? 'In-Scope' : 'Out-of-Scope';

  let comment = `## ${priorityEmoji} ${scopeLabel} - ${issue.title}

**Agent:** ${issue.agent_name}
**Priority:** ${issue.priority}

${issue.description}
`;

  if (issue.location) {
    comment += `\n**Location:** ${issue.location}\n`;
  }

  if (issue.existing_todo) {
    comment += `\n**Existing TODO:** ${issue.existing_todo.has_todo ? `Yes (${issue.existing_todo.issue_reference || 'no reference'})` : 'No'}\n`;
  }

  if (issue.metadata && Object.keys(issue.metadata).length > 0) {
    comment += `\n**Metadata:**\n\`\`\`json\n${JSON.stringify(issue.metadata, null, 2)}\n\`\`\`\n`;
  }

  return comment;
}

/**
 * Post issue as GitHub comment
 * Posts to PR if in phase2, or to issue if in phase1
 *
 * Only posts comment if:
 * 1. Issue is in-scope (always post), OR
 * 2. Issue is out-of-scope AND (no existing_todo OR has_todo is false OR issue_reference is empty)
 *
 * This prevents comment pollution for out-of-scope issues that already have tracked TODOs.
 */
async function postIssueComment(issue: IssueRecord): Promise<void> {
  // Determine if we should post a GitHub comment
  const shouldPostComment =
    issue.scope === 'in-scope' ||
    !issue.existing_todo?.has_todo ||
    !issue.existing_todo?.issue_reference;

  if (!shouldPostComment) {
    logger.info('Skipping GitHub comment for out-of-scope issue with existing TODO reference', {
      agentName: issue.agent_name,
      scope: issue.scope,
      hasTodo: issue.existing_todo?.has_todo,
      issueReference: issue.existing_todo?.issue_reference,
    });
    return;
  }

  const state = await detectCurrentState();
  const commentBody = formatIssueComment(issue);

  if (state.wiggum.phase === 'phase2' && state.pr.exists) {
    // Phase 2: Post to PR
    await postPRComment(state.pr.number, commentBody);
    logger.info('Posted issue comment to PR', {
      prNumber: state.pr.number,
      agentName: issue.agent_name,
      scope: issue.scope,
    });
  } else if (state.wiggum.phase === 'phase1' && state.issue.exists && state.issue.number) {
    // Phase 1: Post to issue
    await ghCli(['issue', 'comment', state.issue.number.toString(), '--body', commentBody]);
    logger.info('Posted issue comment to issue', {
      issueNumber: state.issue.number,
      agentName: issue.agent_name,
      scope: issue.scope,
    });
  } else {
    logger.warn('Cannot post issue comment - no valid PR or issue found', {
      phase: state.wiggum.phase,
      prExists: state.pr.exists,
      issueExists: state.issue.exists,
    });
    throw new ValidationError(
      `Cannot post issue comment. ` +
        `Phase ${state.wiggum.phase} requires ${state.wiggum.phase === 'phase2' ? 'a PR' : 'an issue'} to exist. ` +
        `Current state: PR exists=${state.pr.exists}, Issue exists=${state.issue.exists}`
    );
  }
}

/**
 * Record a review issue to the manifest and post as GitHub comment
 *
 * Error handling strategy: "Best effort" approach to prevent data loss
 * - Try manifest write first
 * - If manifest fails, still try to post GitHub comment (issue visible, not tracked)
 * - If GitHub fails but manifest succeeded (issue tracked, not visible)
 * - If both fail, throw with all details for manual recovery
 */
export async function recordReviewIssue(input: RecordReviewIssueInput): Promise<ToolResult> {
  logger.info('wiggum_record_review_issue', {
    agentName: input.agent_name,
    scope: input.scope,
    priority: input.priority,
    title: input.title,
  });

  // Auto-extract files_to_edit from location if not provided
  // This is a defensive fallback - agents should still provide files_to_edit explicitly
  let filesToEdit = input.files_to_edit;
  if ((!filesToEdit || filesToEdit.length === 0) && input.location) {
    // Extract file path from location like "/path/to/file.ts:45"
    const extractedValue = input.location.split(':')[0];

    // Validate extracted path looks like a file path
    // This prevents descriptive strings like "Multiple files" or Windows drive letters like "C"
    // from being added to files_to_edit, which would cause incorrect batching
    if (extractedValue && looksLikeFilePath(extractedValue)) {
      filesToEdit = [extractedValue];
      logger.info('Auto-extracted files_to_edit from location', {
        location: input.location,
        extractedFile: extractedValue,
        agentName: input.agent_name,
      });
    } else {
      logger.warn('Could not auto-extract valid file path from location', {
        location: input.location,
        extractedValue: extractedValue || '(empty)',
        agentName: input.agent_name,
        impact: 'Issue will not be batched by file - may be in separate batch',
        recommendation: 'Agent should provide files_to_edit explicitly',
      });
      // Don't set filesToEdit - leave it undefined
      // This is safer than adding invalid paths that would cause incorrect batching
    }
  }

  // Create issue record with timestamp
  const issue: IssueRecord = {
    agent_name: input.agent_name,
    scope: input.scope,
    priority: input.priority,
    title: input.title,
    description: input.description,
    location: input.location,
    existing_todo: input.existing_todo,
    metadata: input.metadata,
    timestamp: new Date().toISOString(),
    files_to_edit: filesToEdit,
  };

  let filepath: string | undefined;
  let manifestError: string | undefined;

  // Try to append to manifest
  try {
    filepath = appendToManifest(issue);
  } catch (error) {
    manifestError = error instanceof Error ? error.message : String(error);
    logger.error('Failed to write manifest file - will still try GitHub comment', {
      agentName: input.agent_name,
      error: manifestError,
      impact: 'Issue will not be in manifest but may be posted as GitHub comment',
    });
  }

  // Try to post to GitHub with retry logic
  // Retry helps recover from transient network errors and rate limits
  const MAX_COMMENT_RETRIES = 3;
  let commentError: string | undefined;

  for (let attempt = 1; attempt <= MAX_COMMENT_RETRIES; attempt++) {
    try {
      await postIssueComment(issue);
      // Success - clear any previous error
      commentError = undefined;

      // Log recovery if we succeeded after retry
      if (attempt > 1) {
        logger.warn('GitHub comment succeeded after retry - transient failure recovered', {
          agentName: input.agent_name,
          attempt,
          maxRetries: MAX_COMMENT_RETRIES,
        });
      }
      break;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      commentError = errorObj.message;

      // Check if error is retryable (network errors, rate limits, server errors)
      const errorMsg = commentError.toLowerCase();
      const isRetryable =
        errorMsg.includes('network') ||
        errorMsg.includes('timeout') ||
        errorMsg.includes('rate limit') ||
        errorMsg.includes('429') ||
        errorMsg.includes('502') ||
        errorMsg.includes('503') ||
        errorMsg.includes('504') ||
        errorMsg.includes('econnreset') ||
        errorMsg.includes('econnrefused');

      if (!isRetryable || attempt === MAX_COMMENT_RETRIES) {
        // Non-retryable error or final attempt - log and exit loop
        logger.error('Failed to post GitHub comment', {
          agentName: input.agent_name,
          error: commentError,
          attempt,
          maxRetries: MAX_COMMENT_RETRIES,
          isRetryable,
          manifestSucceeded: filepath !== undefined,
          impact: filepath
            ? 'Issue is in manifest but not visible on GitHub'
            : 'Issue completely lost - neither in manifest nor on GitHub',
        });
        break;
      }

      // Log retry attempt and wait with exponential backoff
      const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      logger.warn('GitHub comment failed - retrying with exponential backoff', {
        agentName: input.agent_name,
        attempt,
        maxRetries: MAX_COMMENT_RETRIES,
        delayMs,
        error: commentError,
      });
      await sleep(delayMs);
    }
  }

  // Handle the four possible outcomes
  if (filepath && !commentError) {
    // Full success
    const successMessage = `✅ Recorded review issue from ${input.agent_name}

**Scope:** ${input.scope}
**Priority:** ${input.priority}
**Title:** ${input.title}

Issue has been:
1. Appended to manifest file: ${filepath}
2. Posted as GitHub comment

Manifest file contains all issues from this agent and scope.`;

    return {
      content: [{ type: 'text', text: successMessage }],
    };
  }

  if (filepath && commentError) {
    // Manifest succeeded, GitHub failed
    const partialMessage = `⚠️ Partial success: Recorded review issue from ${input.agent_name}

**Scope:** ${input.scope}
**Priority:** ${input.priority}
**Title:** ${input.title}

Issue has been:
1. ✅ Appended to manifest file: ${filepath}
2. ❌ Failed to post GitHub comment: ${commentError}

**WARNING:** This issue is tracked in the manifest but NOT visible on GitHub.
Check GitHub API rate limits and connectivity. Issue details:

${input.description}`;

    return {
      content: [{ type: 'text', text: partialMessage }],
      isError: true, // Signal partial failure to caller
      _meta: {
        errorType: 'PartialSuccess',
        errorCode: 'GITHUB_COMMENT_FAILED',
        partialSuccess: true,
        manifestWritten: true,
        commentFailed: true,
        manifestPath: filepath,
      },
    };
  }

  if (!filepath && !commentError) {
    // Manifest failed, GitHub succeeded
    const partialMessage = `⚠️ Partial success: Recorded review issue from ${input.agent_name}

**Scope:** ${input.scope}
**Priority:** ${input.priority}
**Title:** ${input.title}

Issue has been:
1. ❌ Failed to write to manifest file: ${manifestError}
2. ✅ Posted as GitHub comment

**WARNING:** This issue will NOT be included in manifest-based agent completion tracking.
Manual verification required. Check filesystem permissions and disk space.`;

    return {
      content: [{ type: 'text', text: partialMessage }],
      isError: true, // Signal partial failure to caller
      _meta: {
        errorType: 'PartialSuccess',
        errorCode: 'MANIFEST_WRITE_FAILED',
        partialSuccess: true,
        manifestWritten: false,
        commentFailed: false,
        manifestError: manifestError,
      },
    };
  }

  // Both failed - total failure, throw with all details for manual recovery
  throw new ValidationError(
    `Failed to record review issue from ${input.agent_name}:\n\n` +
      `1. Manifest write failed: ${manifestError}\n` +
      `2. GitHub comment failed: ${commentError}\n\n` +
      `Issue details (COPY THIS TO GITHUB MANUALLY):\n` +
      `Title: ${input.title}\n` +
      `Description: ${input.description}\n` +
      `Location: ${input.location || 'N/A'}\n\n` +
      `Check filesystem permissions, disk space, and GitHub API connectivity.`
  );
}
