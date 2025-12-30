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
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { detectCurrentState } from '../state/detector.js';
import { postPRComment, sleep } from '../utils/gh-cli.js';
import { ghCli } from '../utils/gh-cli.js';
import { logger } from '../utils/logger.js';
import { FilesystemError, ValidationError, GitHubCliError } from '../utils/errors.js';
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
 * Result of file path validation with rejection reason for debugging
 */
interface FilePathValidation {
  /** Whether the value looks like a valid file path */
  valid: boolean;
  /** Reason for rejection (only present when valid is false) */
  reason?: string;
}

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
 *
 * Returns validation result with rejection reason for debugging when validation fails.
 */
function looksLikeFilePath(value: string): FilePathValidation {
  if (!value || value.length === 0) {
    return { valid: false, reason: 'empty string' };
  }

  // Descriptive strings usually have spaces
  if (value.includes(' ')) {
    return { valid: false, reason: 'contains spaces (likely descriptive text, not a file path)' };
  }

  // Must have a path separator
  if (!value.includes('/') && !value.includes('\\')) {
    return { valid: false, reason: 'no path separator (/ or \\)' };
  }

  // Must end with a known file extension
  const lowerValue = value.toLowerCase();
  const hasKnownExtension = KNOWN_FILE_EXTENSIONS.some((ext) => lowerValue.endsWith(ext));
  if (!hasKnownExtension) {
    // Show first few extensions to hint at what's expected
    const extensionSample = KNOWN_FILE_EXTENSIONS.slice(0, 5).join(', ');
    return {
      valid: false,
      reason: `unknown file extension (expected: ${extensionSample}, ...)`,
    };
  }

  return { valid: true };
}

/**
 * Serialized error details for debugging
 *
 * Contains structured information about an error that can be safely serialized
 * to JSON and included in _meta for debugging partial success scenarios.
 */
interface SerializedError {
  /** Error message */
  message: string;
  /** Error class name (e.g., 'GitHubCliError', 'FilesystemError') */
  name: string;
  /** Stack trace for debugging (if available) */
  stack?: string;
  /** Exit code for process errors (GitHubCliError) */
  exitCode?: number;
  /** Standard error output for process errors (GitHubCliError) */
  stderr?: string;
  /** Standard output for process errors (GitHubCliError) */
  stdout?: string;
  /** Original error code (e.g., 'EACCES', 'ENOENT') */
  code?: string;
}

/**
 * Serialize an error to a structured object for debugging
 *
 * Extracts relevant information from error objects including:
 * - Standard Error properties (message, name, stack)
 * - GitHubCliError properties (exitCode, stderr, stdout)
 * - Node.js error code (for filesystem errors)
 *
 * This enables preserving full error context in _meta for debugging
 * partial success scenarios without losing valuable diagnostic information.
 */
function serializeError(error: Error): SerializedError {
  const serialized: SerializedError = {
    message: error.message,
    name: error.name,
  };

  // Include stack trace if available
  if (error.stack) {
    serialized.stack = error.stack;
  }

  // Include GitHubCliError-specific fields
  if (error instanceof GitHubCliError) {
    serialized.exitCode = error.exitCode;
    serialized.stderr = error.stderr;
    if (error.stdout) {
      serialized.stdout = error.stdout;
    }
  }

  // Include Node.js error code (for filesystem errors)
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code) {
    serialized.code = nodeError.code;
  }

  return serialized;
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
 * CRITICAL: If a filename collision is detected, we fail loudly instead of silently
 * appending. A collision indicates a serious bug in the filename generation logic
 * (timestamp or random bytes generation), and masking it would make debugging harder.
 */
function appendToManifest(issue: IssueRecord): string {
  const manifestDir = getOrCreateManifestDir();
  const filename = generateManifestFilename(issue.agent_name, issue.scope);
  const filepath = join(manifestDir, filename);

  try {
    // TODO(#1001): Simplify verbose TODO comment in appendToManifest function
    // CRITICAL: Each call creates a UNIQUE file (timestamp + 4-byte random).
    // If this file exists, we have a serious bug in filename generation.
    // Fail loudly instead of masking the issue by silently appending.
    if (existsSync(filepath)) {
      logger.error('Manifest filename collision detected - impossible bug triggered', {
        filepath,
        agentName: issue.agent_name,
        impact: 'Filename generation is broken - timestamp or random function failing',
      });
      throw new FilesystemError(
        `Manifest file already exists: ${filepath}. This should be impossible. ` +
          `Check Date.now() and randomBytes() for bugs.`,
        filepath,
        new Error('Filename collision detected')
      );
    }

    // Write new file (single issue array)
    const issues = [issue];
    writeFileSync(filepath, JSON.stringify(issues, null, 2), 'utf-8');

    logger.info('Created new manifest file', {
      filepath,
      issueCount: 1,
      agentName: issue.agent_name,
      scope: issue.scope,
      priority: issue.priority,
    });

    return filepath;
  } catch (error) {
    // Re-throw FilesystemError (already properly formatted from collision detection)
    if (error instanceof FilesystemError) {
      throw error;
    }

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
    const validation = looksLikeFilePath(extractedValue || '');
    if (extractedValue && validation.valid) {
      filesToEdit = [extractedValue];
      logger.info('Auto-extracted files_to_edit from location', {
        location: input.location,
        extractedFile: extractedValue,
        agentName: input.agent_name,
      });
    } else {
      // Log at ERROR level for in-scope issues (batching is critical for parallel execution)
      // Log at WARN level for out-of-scope issues (batching is less important)
      const logData = {
        location: input.location,
        extractedValue: extractedValue || '(empty)',
        rejectionReason: validation.reason || 'unknown',
        agentName: input.agent_name,
        scope: input.scope,
        impact:
          input.scope === 'in-scope'
            ? 'CRITICAL: Issue will not be batched with related issues - parallel execution impacted'
            : 'Issue will not be batched - may be in separate batch',
        recommendation: 'Agent should provide files_to_edit explicitly in input',
        action:
          input.scope === 'in-scope'
            ? 'Review agent implementation to ensure files_to_edit is provided'
            : undefined,
      };

      if (input.scope === 'in-scope') {
        logger.error('Could not auto-extract valid file path from location', logData);
      } else {
        logger.warn('Could not auto-extract valid file path from location', logData);
      }
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
  let manifestErrorDetails: SerializedError | undefined;

  // Try to append to manifest
  try {
    filepath = appendToManifest(issue);
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    manifestError = errorObj.message;
    manifestErrorDetails = serializeError(errorObj);
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
  let commentErrorDetails: SerializedError | undefined;

  for (let attempt = 1; attempt <= MAX_COMMENT_RETRIES; attempt++) {
    try {
      await postIssueComment(issue);
      // Success - clear any previous error and error details
      commentError = undefined;
      commentErrorDetails = undefined;

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
      commentErrorDetails = serializeError(errorObj);

      // Check for non-retryable errors FIRST to avoid unnecessary retry delays
      // ValidationError indicates phase state is invalid - retrying won't help
      if (error instanceof ValidationError) {
        logger.error('Failed to post GitHub comment - validation error (non-retryable)', {
          agentName: input.agent_name,
          error: commentError,
          attempt,
          errorType: 'validation',
          manifestSucceeded: filepath !== undefined,
          impact: filepath
            ? 'Issue is in manifest but not visible on GitHub'
            : 'Issue completely lost - neither in manifest nor on GitHub',
        });
        break; // Exit immediately, don't retry
      }

      // Check if error is retryable based on exit code or message patterns
      const errorMsg = commentError.toLowerCase();

      // Check GitHubCliError exit codes for HTTP status codes (more reliable than message matching)
      const hasRetryableExitCode =
        error instanceof GitHubCliError &&
        error.exitCode !== undefined &&
        [429, 502, 503, 504].includes(error.exitCode);

      // Fall back to message pattern matching for other transient errors
      const hasRetryableMessage =
        errorMsg.includes('network') ||
        errorMsg.includes('timeout') ||
        errorMsg.includes('rate limit') ||
        errorMsg.includes('429') ||
        errorMsg.includes('502') ||
        errorMsg.includes('503') ||
        errorMsg.includes('504') ||
        errorMsg.includes('econnreset') ||
        errorMsg.includes('econnrefused');

      const isRetryable = hasRetryableExitCode || hasRetryableMessage;

      if (!isRetryable) {
        // Non-retryable error - exit immediately without retrying
        logger.error('Failed to post GitHub comment - error is not retryable', {
          agentName: input.agent_name,
          error: commentError,
          attempt,
          errorType: 'non-retryable',
          exitCode: error instanceof GitHubCliError ? error.exitCode : undefined,
          manifestSucceeded: filepath !== undefined,
          impact: filepath
            ? 'Issue is in manifest but not visible on GitHub'
            : 'Issue completely lost - neither in manifest nor on GitHub',
        });
        break;
      }

      if (attempt === MAX_COMMENT_RETRIES) {
        // Exhausted all retries - final attempt failed
        logger.error('Failed to post GitHub comment - exhausted all retries', {
          agentName: input.agent_name,
          error: commentError,
          attempt,
          maxRetries: MAX_COMMENT_RETRIES,
          errorType: 'exhausted-retries',
          exitCode: error instanceof GitHubCliError ? error.exitCode : undefined,
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
        exitCode: error instanceof GitHubCliError ? error.exitCode : undefined,
      });
      await sleep(delayMs);
    }
  }

  // Handle the four possible outcomes
  if (filepath && !commentError) {
    // Full success
    // Include files_to_edit status warning when missing for in-scope issues
    const filesToEditWarning =
      input.scope === 'in-scope' && (!filesToEdit || filesToEdit.length === 0)
        ? '\n**Warning:** No files_to_edit - issue may not be batched correctly for parallel execution\n'
        : '';

    const successMessage = `✅ Recorded review issue from ${input.agent_name}

**Scope:** ${input.scope}
**Priority:** ${input.priority}
**Title:** ${input.title}
${filesToEditWarning}
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
        // Include full error details for debugging (stack trace, exit code, stderr, etc.)
        error: commentErrorDetails,
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
        // Include full error details for debugging (stack trace, error code, etc.)
        error: manifestErrorDetails,
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
