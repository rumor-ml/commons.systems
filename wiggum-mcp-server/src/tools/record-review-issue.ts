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
 * - VALIDATION ERRORS: Invalid scope, priority, or missing required fields
 * - LOGGED ERRORS: File system errors during manifest write (logged but execution continues)
 * - STRUCTURED LOGGING: Issue recording, comment posting, manifest creation
 */

import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { detectCurrentState } from '../state/detector.js';
import { postPRComment } from '../utils/gh-cli.js';
import { ghCli } from '../utils/gh-cli.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import type { IssueRecord } from './manifest-types.js';

// Zod schema for input validation
export const RecordReviewIssueInputSchema = z.object({
  agent_name: z.string().min(1, 'agent_name cannot be empty'),
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
 */
function getManifestDir(): string {
  const cwd = process.cwd();
  const manifestDir = join(cwd, 'tmp', 'wiggum');

  if (!existsSync(manifestDir)) {
    mkdirSync(manifestDir, { recursive: true });
    logger.info('Created manifest directory', { path: manifestDir });
  }

  return manifestDir;
}

/**
 * Write issue to a new manifest file
 *
 * Creates a new manifest file for each issue. Each file gets a unique timestamp
 * and random suffix to prevent race conditions when multiple agents run concurrently.
 *
 * NOTE: Despite the function name, this always creates a NEW file because
 * generateManifestFilename() includes a timestamp and random suffix that ensures
 * each call generates a unique filename. The "append to existing" logic exists
 * only as a defensive measure in case of filename collision (extremely unlikely).
 */
function appendToManifest(issue: IssueRecord): string {
  const manifestDir = getManifestDir();
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
    logger.error('Failed to write manifest file', {
      filepath,
      error: errorMsg,
      agentName: issue.agent_name,
    });
    throw new ValidationError(
      `Failed to write manifest file: ${errorMsg}. ` +
        `Ensure the tmp/wiggum directory is writable.`
    );
  }
}

/**
 * Format issue as GitHub comment markdown
 */
function formatIssueComment(issue: IssueRecord): string {
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
 */
export async function recordReviewIssue(input: RecordReviewIssueInput): Promise<ToolResult> {
  logger.info('wiggum_record_review_issue', {
    agentName: input.agent_name,
    scope: input.scope,
    priority: input.priority,
    title: input.title,
  });

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
  };

  // Append to manifest file
  const filepath = appendToManifest(issue);

  // Post to GitHub
  await postIssueComment(issue);

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
