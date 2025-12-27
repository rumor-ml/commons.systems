/**
 * Shared helper for PR review and security review completion tools
 *
 * This module extracts common logic from complete-pr-review.ts and
 * complete-security-review.ts to reduce duplication while preserving
 * the distinct behavior of each review type.
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import {
  getNextStepInstructions,
  safePostStateComment,
  safePostIssueStateComment,
  type StateCommentResult,
} from '../state/router.js';
import { addToCompletedSteps, applyWiggumState } from '../state/state-utils.js';
import {
  MAX_ITERATIONS,
  STEP_NAMES,
  generateTriageInstructions,
  generateOutOfScopeTrackingInstructions,
  generateScopeSeparatedFixInstructions,
} from '../constants.js';
import type { WiggumStep, WiggumPhase } from '../constants.js';
import { ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { logger } from '../utils/logger.js';
import type { CurrentState, WiggumState } from '../state/types.js';
import { readFile, stat } from 'fs/promises';

/**
 * Known agent names for validation and warnings
 *
 * These are the expected agent names in the scope-separated review workflow.
 * Used to warn when an unexpected agent name is extracted from file paths.
 */
const KNOWN_AGENT_NAMES = [
  'code-reviewer',
  'silent-failure-hunter',
  'code-simplifier',
  'comment-analyzer',
  'pr-test-analyzer',
  'type-design-analyzer',
];

/**
 * Extract agent name from file path
 *
 * Parses the wiggum output file naming convention to extract a human-readable
 * agent name. Converts kebab-case to Title Case by capitalizing the first
 * letter of each word. Note: Acronyms like 'pr' become 'Pr' not 'PR'.
 *
 * @param filePath - Full path to the review output file
 * @returns Human-readable agent name, or 'Unknown Agent (filename)' if parsing fails
 *
 * @example
 * extractAgentNameFromPath('/tmp/claude/wiggum-625/code-reviewer-in-scope-1234.md')
 * // Returns: 'Code Reviewer'
 *
 * @example
 * extractAgentNameFromPath('/tmp/claude/wiggum-625/pr-test-analyzer-out-of-scope-5678.md')
 * // Returns: 'Pr Test Analyzer' (note: 'pr' acronym becomes 'Pr', not 'PR')
 */
export function extractAgentNameFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop() || '';

  // Match pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}.md
  const match = fileName.match(/^(.+?)-(in-scope|out-of-scope)-\d+\.md$/);

  if (!match) {
    // Pattern didn't match - file name is malformed
    logger.warn('Failed to extract agent name from file path - unexpected format', {
      filePath,
      fileName,
      expectedPattern: '{agent-name}-(in-scope|out-of-scope)-{timestamp}.md',
    });
    return `Unknown Agent (${fileName})`;
  }

  const agentSlug = match[1];

  // Validate extracted name is non-empty
  if (!agentSlug || agentSlug.trim().length === 0) {
    logger.warn('Extracted empty agent name from file path', {
      filePath,
      fileName,
    });
    return `Unknown Agent (${fileName})`;
  }

  // Warn if agent name doesn't match known agents (might be typo or new agent)
  if (!KNOWN_AGENT_NAMES.includes(agentSlug)) {
    logger.warn('Extracted agent name not in known agents list', {
      filePath,
      extractedName: agentSlug,
      knownAgents: KNOWN_AGENT_NAMES,
      suggestion: 'Update KNOWN_AGENT_NAMES if this is a new agent',
    });
  }

  // Convert kebab-case to Title Case
  const agentName = agentSlug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return agentName;
}

/**
 * Enhanced file read error with diagnostic information
 */
interface FileReadError {
  filePath: string;
  error: Error;
  category: 'in-scope' | 'out-of-scope';
  errorCode?: string;
  fileExists?: boolean;
  fileSize?: number;
}

/**
 * Load review results from scope-separated file lists
 *
 * Reads multiple review result files and aggregates them with agent headers.
 * Collects errors from all file reads and provides comprehensive error context
 * if any files fail to read. Includes error codes and file metadata for diagnostics.
 *
 * @param inScopeFiles - Array of file paths containing in-scope review results
 * @param outOfScopeFiles - Array of file paths containing out-of-scope review results
 * @returns Object with formatted in-scope and out-of-scope sections
 * @throws {ValidationError} If any files fail to read, with details of all failures including error codes
 *
 * @example
 * // Load results from multiple agent files
 * const { inScope, outOfScope } = await loadReviewResults(
 *   ['/tmp/claude/wiggum-625/code-reviewer-in-scope-1234.md'],
 *   ['/tmp/claude/wiggum-625/code-reviewer-out-of-scope-1234.md']
 * );
 */
export async function loadReviewResults(
  inScopeFiles: string[] = [],
  outOfScopeFiles: string[] = []
): Promise<{ inScope: string; outOfScope: string }> {
  const errors: FileReadError[] = [];

  const inScopeResults: string[] = [];
  for (const filePath of inScopeFiles) {
    try {
      // Check file exists and get metadata before reading
      const stats = await stat(filePath);

      // Warn if file is empty (possible agent crash during write)
      if (stats.size === 0) {
        logger.warn('Review file is empty - possible incomplete write', {
          filePath,
          agentName: extractAgentNameFromPath(filePath),
        });
      }

      const content = await readFile(filePath, 'utf-8');

      // Validate content is non-empty (readFile can succeed on empty file)
      if (content.trim().length === 0) {
        throw new Error('File is empty - review agent may not have completed');
      }

      const agentName = extractAgentNameFromPath(filePath);
      inScopeResults.push(`#### ${agentName}\n\n${content}\n\n---\n`);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const nodeError = errorObj as NodeJS.ErrnoException;

      // Try to get file metadata for diagnostics
      let fileExists = false;
      let fileSize: number | undefined;
      try {
        const stats = await stat(filePath);
        fileExists = true;
        fileSize = stats.size;
      } catch {
        // Ignore stat errors, we're already in error path
      }

      errors.push({
        filePath,
        error: errorObj,
        category: 'in-scope',
        errorCode: nodeError.code,
        fileExists,
        fileSize,
      });

      logger.error('Failed to read in-scope review file', {
        filePath,
        errorMessage: errorObj.message,
        errorCode: nodeError.code,
        errorStack: errorObj.stack,
        fileExists,
        fileSize,
      });
    }
  }

  const outOfScopeResults: string[] = [];
  for (const filePath of outOfScopeFiles) {
    try {
      // Check file exists and get metadata before reading
      const stats = await stat(filePath);

      // Warn if file is empty (possible agent crash during write)
      if (stats.size === 0) {
        logger.warn('Review file is empty - possible incomplete write', {
          filePath,
          agentName: extractAgentNameFromPath(filePath),
        });
      }

      const content = await readFile(filePath, 'utf-8');

      // Validate content is non-empty
      if (content.trim().length === 0) {
        throw new Error('File is empty - review agent may not have completed');
      }

      const agentName = extractAgentNameFromPath(filePath);
      outOfScopeResults.push(`#### ${agentName}\n\n${content}\n\n---\n`);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const nodeError = errorObj as NodeJS.ErrnoException;

      // Try to get file metadata for diagnostics
      let fileExists = false;
      let fileSize: number | undefined;
      try {
        const stats = await stat(filePath);
        fileExists = true;
        fileSize = stats.size;
      } catch {
        // Ignore stat errors, we're already in error path
      }

      errors.push({
        filePath,
        error: errorObj,
        category: 'out-of-scope',
        errorCode: nodeError.code,
        fileExists,
        fileSize,
      });

      logger.error('Failed to read out-of-scope review file', {
        filePath,
        errorMessage: errorObj.message,
        errorCode: nodeError.code,
        errorStack: errorObj.stack,
        fileExists,
        fileSize,
      });
    }
  }

  // If ANY files failed, throw comprehensive error with all failure details
  if (errors.length > 0) {
    const errorDetails = errors
      .map(({ filePath, error, category, errorCode, fileExists, fileSize }) => {
        const code = errorCode ? ` [${errorCode}]` : '';
        const existence =
          fileExists !== undefined
            ? ` (exists: ${fileExists}, size: ${fileSize ?? 'unknown'})`
            : '';
        return `  - [${category}] ${filePath}${code}: ${error.message}${existence}`;
      })
      .join('\n');

    const successCount = inScopeFiles.length + outOfScopeFiles.length - errors.length;

    // Classify errors to help user decide action
    const hasPermissionErrors = errors.some((e) => e.errorCode === 'EACCES');
    const hasMissingFiles = errors.some((e) => e.errorCode === 'ENOENT');
    const hasEmptyFiles = errors.some((e) => e.fileExists && e.fileSize === 0);

    let actionHint = '';
    if (hasMissingFiles) {
      actionHint =
        '\nAction: Check that review agents completed successfully before calling this tool.';
    } else if (hasPermissionErrors) {
      actionHint = '\nAction: Fix file permissions and retry.';
    } else if (hasEmptyFiles) {
      actionHint = '\nAction: Review agents may have crashed during write - check agent logs.';
    }

    throw new ValidationError(
      `Failed to read ${errors.length} review result file(s) (${successCount} succeeded):\n${errorDetails}${actionHint}`
    );
  }

  return {
    inScope: inScopeResults.length > 0 ? `## In-Scope Issues\n\n${inScopeResults.join('\n')}` : '',
    outOfScope:
      outOfScopeResults.length > 0
        ? `## Out-of-Scope Recommendations\n\n${outOfScopeResults.join('\n')}`
        : '',
  };
}

/**
 * Load verbatim response from file or inline parameter
 *
 * @param input - Review completion input
 * @returns The verbatim response content
 * @throws ValidationError if neither parameter provided or file unreadable
 */
export async function loadVerbatimResponse(input: ReviewCompletionInput): Promise<string> {
  // New format: file-based scope-separated results
  if (input.in_scope_files || input.out_of_scope_files) {
    const { inScope, outOfScope } = await loadReviewResults(
      input.in_scope_files,
      input.out_of_scope_files
    );
    const sections = [inScope, outOfScope].filter(Boolean);
    return sections.join('\n\n');
  }

  // Old format: single verbatim response
  if (!input.verbatim_response && !input.verbatim_response_file) {
    throw new ValidationError(
      `Either verbatim_response or verbatim_response_file must be provided. ` +
        `Preferred: write review output to /tmp/claude/wiggum-{worktree}-{review-type}-{timestamp}.md ` +
        `and pass the file path via verbatim_response_file parameter.`
    );
  }

  // If both provided: prefer file with warning
  if (input.verbatim_response && input.verbatim_response_file) {
    logger.warn(
      'Both verbatim_response and verbatim_response_file provided - using file (verbatim_response_file takes precedence)',
      {
        filePath: input.verbatim_response_file,
        inlineLength: input.verbatim_response.length,
      }
    );
  }

  // If file path provided: read and return content
  if (input.verbatim_response_file) {
    try {
      const content = await readFile(input.verbatim_response_file, 'utf-8');
      logger.info('Loaded verbatim response from temp file', {
        filePath: input.verbatim_response_file,
        contentLength: content.length,
      });
      return content;
    } catch (error) {
      // Handle specific known file system errors explicitly for better user feedback
      if (error instanceof Error) {
        const nodeError = error as NodeJS.ErrnoException;

        if (nodeError.code === 'ENOENT') {
          throw new ValidationError(
            `File not found: "${input.verbatim_response_file}". ` +
              `Ensure the review output was written to the temp file before calling this tool. ` +
              `File pattern: /tmp/claude/wiggum-{worktree}-{review-type}-{timestamp}.md`
          );
        }

        if (nodeError.code === 'EACCES') {
          throw new ValidationError(
            `Permission denied reading file: "${input.verbatim_response_file}". ` +
              `Check file permissions.`
          );
        }

        if (nodeError.code === 'EISDIR') {
          throw new ValidationError(
            `Path is a directory, not a file: "${input.verbatim_response_file}". ` +
              `Expected a file path.`
          );
        }

        // Log unexpected errors with full context before re-throwing
        logger.error('Unexpected error reading verbatim response file', {
          filePath: input.verbatim_response_file,
          errorCode: nodeError.code,
          errorMessage: error.message,
          errorStack: error.stack,
        });

        throw new ValidationError(
          `Unexpected error reading file: "${input.verbatim_response_file}": ${error.message}. ` +
            `This may indicate a system issue. Check logs for details.`
        );
      }

      // Non-Error exceptions (very rare, indicates programming error)
      logger.error('Non-Error exception in file read', {
        filePath: input.verbatim_response_file,
        exception: String(error),
      });

      throw new ValidationError(
        `Unexpected exception reading file (programming error): ${String(error)}`
      );
    }
  }

  // If inline: return (deprecated path)
  logger.warn(
    'Using deprecated verbatim_response parameter - consider using verbatim_response_file to reduce token usage',
    {
      inlineLength: input.verbatim_response!.length,
    }
  );
  return input.verbatim_response!;
}

/**
 * Zod schema for ReviewConfig runtime validation
 */
export const ReviewConfigSchema = z.object({
  phase1Step: z.string(),
  phase2Step: z.string(),
  phase1Command: z.string(),
  phase2Command: z.string(),
  reviewTypeLabel: z.string(),
  issueTypeLabel: z.string(),
  successMessage: z.string(),
});

/**
 * Configuration for a review type (PR or Security)
 * TODO(#333, #363): Add readonly modifiers (runtime validation via ReviewConfigSchema added)
 */
export interface ReviewConfig {
  /** Step identifier for Phase 1 */
  phase1Step: WiggumStep;
  /** Step identifier for Phase 2 */
  phase2Step: WiggumStep;
  /** Command for Phase 1 */
  phase1Command: string;
  /** Command for Phase 2 */
  phase2Command: string;
  /** Type label for logging and messages (e.g., "PR", "Security") */
  reviewTypeLabel: string;
  /** Issue type for messages (e.g., "issue(s)", "security issue(s)") */
  issueTypeLabel: string;
  /** Success message for when no issues found */
  successMessage: string;
}

/**
 * Zod schema for ReviewCompletionInput runtime validation
 *
 * Issue counts are validated at schema level to be integers (no decimals) >= 0.
 * Note: Zod .int().nonnegative() does not validate against Infinity, NaN, or
 * unsafe integers exceeding Number.MAX_SAFE_INTEGER. Additional runtime validation
 * in completeReview() provides comprehensive checks including finite/safe integer validation.
 *
 * @see completeReview for complete validation including Infinity/NaN/overflow checks
 */
export const ReviewCompletionInputSchema = z.object({
  command_executed: z.boolean(),
  // Old format (deprecated but supported)
  verbatim_response: z.string().optional(),
  verbatim_response_file: z.string().optional(),
  high_priority_issues: z.number().int().nonnegative().optional(),
  medium_priority_issues: z.number().int().nonnegative().optional(),
  low_priority_issues: z.number().int().nonnegative().optional(),
  // New format
  in_scope_files: z.array(z.string()).optional(),
  out_of_scope_files: z.array(z.string()).optional(),
  in_scope_count: z.number().int().nonnegative().optional(),
  out_of_scope_count: z.number().int().nonnegative().optional(),
});

/**
 * Input for review completion
 *
 * Basic integer validation via Zod schema (.int().nonnegative()) catches decimals and negatives.
 * Complete validation in completeReview() adds: Infinity/NaN checks, safe integer validation,
 * count vs file array length consistency, and detailed error messages.
 *
 * @see ReviewCompletionInputSchema for Zod schema validation
 * @see completeReview for complete runtime validation
 */
export interface ReviewCompletionInput {
  command_executed: boolean;
  // Old format (deprecated but supported)
  verbatim_response?: string;
  verbatim_response_file?: string;
  high_priority_issues?: number;
  medium_priority_issues?: number;
  low_priority_issues?: number;
  // New format
  in_scope_files?: string[];
  out_of_scope_files?: string[];
  in_scope_count?: number;
  out_of_scope_count?: number;
}

/**
 * Get the review step based on current phase
 */
function getReviewStep(phase: WiggumPhase, config: ReviewConfig): WiggumStep {
  return phase === 'phase1' ? config.phase1Step : config.phase2Step;
}

/**
 * Validate phase requirements (issue for phase1, PR for phase2)
 */
function validatePhaseRequirements(state: CurrentState, config: ReviewConfig): void {
  if (state.wiggum.phase === 'phase1' && (!state.issue.exists || !state.issue.number)) {
    // TODO(#312): Add Sentry error ID for tracking
    throw new ValidationError(
      `No issue found. Phase 1 ${config.reviewTypeLabel.toLowerCase()} review requires an issue number in the branch name.`
    );
  }

  if (state.wiggum.phase === 'phase2' && (!state.pr.exists || !state.pr.number)) {
    // TODO(#312): Add Sentry error ID for tracking
    throw new ValidationError(
      `No PR found. Cannot complete ${config.reviewTypeLabel.toLowerCase()} review.`
    );
  }
}

interface IssueCounts {
  high: number;
  medium: number;
  low: number;
  total: number;
}

/**
 * Build comment content based on review results
 * TODO(#334): Add test for phase-specific command selection
 */
export function buildCommentContent(
  verbatimResponse: string,
  reviewStep: WiggumStep,
  issues: IssueCounts,
  config: ReviewConfig,
  phase: WiggumPhase
): { title: string; body: string } {
  const commandExecuted = phase === 'phase1' ? config.phase1Command : config.phase2Command;

  const title =
    issues.total > 0
      ? `Step ${reviewStep} (${STEP_NAMES[reviewStep]}) - Issues Found`
      : `Step ${reviewStep} (${STEP_NAMES[reviewStep]}) Complete - No Issues`;

  const body =
    issues.total > 0
      ? `**Command Executed:** \`${commandExecuted}\`

**${config.reviewTypeLabel} Issues Found:**
- High Priority: ${issues.high}
- Medium Priority: ${issues.medium}
- Low Priority: ${issues.low}
- **Total: ${issues.total}**

<details>
<summary>Full ${config.reviewTypeLabel} Review Output</summary>

${verbatimResponse}

</details>

**Next Action:** Plan and implement ${config.reviewTypeLabel.toLowerCase()} fixes for all issues, then call \`wiggum_complete_fix\`.`
      : `**Command Executed:** \`${commandExecuted}\`

${config.successMessage}`;

  return { title, body };
}

/**
 * Build new state based on review results
 */
function buildNewState(
  currentState: CurrentState,
  reviewStep: WiggumStep,
  hasInScopeIssues: boolean
): WiggumState {
  // Only increment iteration for in-scope issues
  if (hasInScopeIssues) {
    return {
      iteration: currentState.wiggum.iteration + 1,
      step: reviewStep,
      completedSteps: currentState.wiggum.completedSteps,
      phase: currentState.wiggum.phase,
    };
  }

  // If no in-scope issues (even if out-of-scope exist), mark complete
  return {
    iteration: currentState.wiggum.iteration,
    step: reviewStep,
    completedSteps: addToCompletedSteps(currentState.wiggum.completedSteps, reviewStep),
    phase: currentState.wiggum.phase,
  };
}

/**
 * Post state comment to issue (phase1) or PR (phase2)
 */
async function postStateComment(
  state: CurrentState,
  newState: {
    iteration: number;
    step: WiggumStep;
    completedSteps: WiggumStep[];
    phase: WiggumPhase;
  },
  title: string,
  body: string
): Promise<StateCommentResult> {
  if (state.wiggum.phase === 'phase1') {
    if (!state.issue.exists || !state.issue.number) {
      // TODO(#312): Add Sentry error ID for tracking
      throw new ValidationError(
        'Internal error: Phase 1 requires issue number, but validation passed with no issue'
      );
    }
    return await safePostIssueStateComment(
      state.issue.number,
      newState,
      title,
      body,
      newState.step
    );
  } else {
    if (!state.pr.exists || !state.pr.number) {
      // TODO(#312): Add Sentry error ID for tracking
      throw new ValidationError(
        'Internal error: Phase 2 requires PR number, but validation passed with no PR'
      );
    }
    return await safePostStateComment(state.pr.number, newState, title, body, newState.step);
  }
}

/**
 * Build iteration limit response
 */
function buildIterationLimitResponse(
  state: CurrentState,
  reviewStep: WiggumStep,
  issues: IssueCounts,
  newIteration: number
): ToolResult {
  const output = {
    current_step: STEP_NAMES[reviewStep],
    step_number: reviewStep,
    iteration_count: newIteration,
    instructions: `Maximum iteration limit (${MAX_ITERATIONS}) reached. Manual intervention required.`,
    steps_completed_by_tool: [
      'Executed review',
      state.wiggum.phase === 'phase1' ? 'Posted results to issue' : 'Posted results to PR',
      'Updated state',
    ],
    context: {
      pr_number: state.wiggum.phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
      issue_number:
        state.wiggum.phase === 'phase1' && state.issue.exists ? state.issue.number : undefined,
      total_issues: issues.total,
    },
  };
  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Build triage/fix instructions response when issues are found
 */
function buildIssuesFoundResponse(
  state: CurrentState,
  reviewStep: WiggumStep,
  issues: IssueCounts,
  newIteration: number,
  config: ReviewConfig,
  inScopeCount: number,
  outOfScopeCount: number,
  inScopeFiles?: string[],
  outOfScopeFiles?: string[]
): ToolResult {
  const issueNumber = state.issue.exists ? state.issue.number : undefined;

  // Issue number is required for triage workflow to properly scope fixes
  // TODO(#312): Add Sentry error ID for tracking
  // TODO(#314): Add actionable error context when issueNumber is undefined
  if (!issueNumber) {
    throw new ValidationError(
      `Issue number required for triage workflow but was undefined. This indicates a state detection issue. Branch: ${state.git.currentBranch}, Phase: ${state.wiggum.phase}`
    );
  }

  // Detect if we're using the new scope-separated format
  const usingScopeSeparatedFormat = !!inScopeFiles;

  logger.info(
    `Providing ${usingScopeSeparatedFormat ? 'parallel fix' : 'triage'} instructions for ${config.reviewTypeLabel.toLowerCase()} review issues`,
    {
      phase: state.wiggum.phase,
      issueNumber,
      totalIssues: issues.total,
      inScopeCount,
      outOfScopeCount,
      usingScopeSeparatedFormat,
      iteration: newIteration,
    }
  );

  const reviewTypeForTriage = config.reviewTypeLabel === 'Security' ? 'Security' : 'PR';

  // Choose instructions based on format
  let instructions: string;
  if (usingScopeSeparatedFormat) {
    // New workflow: Launch 2 agents in parallel (triage already done)
    instructions = generateScopeSeparatedFixInstructions(
      issueNumber,
      reviewTypeForTriage,
      inScopeCount,
      inScopeFiles!,
      outOfScopeCount,
      outOfScopeFiles ?? []
    );
  } else {
    // Old workflow: Enter plan mode, triage, then execute
    instructions = generateTriageInstructions(issueNumber, reviewTypeForTriage, issues.total);
  }

  const output = {
    current_step: STEP_NAMES[reviewStep],
    step_number: reviewStep,
    iteration_count: newIteration,
    instructions,
    steps_completed_by_tool: [
      `Executed ${config.reviewTypeLabel.toLowerCase()} review`,
      state.wiggum.phase === 'phase1' ? 'Posted results to issue' : 'Posted results to PR',
      'Incremented iteration',
    ],
    context: {
      pr_number: state.wiggum.phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
      issue_number: issueNumber,
      total_issues: issues.total,
      in_scope_count: inScopeCount,
      out_of_scope_count: outOfScopeCount,
    },
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Complete a review (PR or Security) and update workflow state
 *
 * This is the shared implementation for both complete-pr-review and
 * complete-security-review tools. It handles:
 * - Command execution validation
 * - Phase requirements validation
 * - Comment posting to issue or PR
 * - State updates
 * - Iteration limit checking
 * - Triage instructions generation
 *
 * @param input - Review completion input with issue counts and response
 * @param config - Configuration for the specific review type
 * @returns Tool result with next step instructions
 */
export async function completeReview(
  input: ReviewCompletionInput,
  config: ReviewConfig
): Promise<ToolResult> {
  if (!input.command_executed) {
    // TODO(#312): Add Sentry error ID for tracking
    throw new ValidationError(
      `command_executed must be true. Do not shortcut the ${config.reviewTypeLabel.toLowerCase()} review process.`
    );
  }

  // Load verbatim response from file or inline parameter
  const verbatimResponse = await loadVerbatimResponse(input);

  const state = await detectCurrentState();
  const reviewStep = getReviewStep(state.wiggum.phase, config);

  validatePhaseRequirements(state, config);

  // Handle both old and new format
  const inScopeCount = input.in_scope_count ?? 0;
  const outOfScopeCount = input.out_of_scope_count ?? 0;

  // Validate all numeric counts are non-negative safe integers
  const countFields = [
    { name: 'high_priority_issues', value: input.high_priority_issues },
    { name: 'medium_priority_issues', value: input.medium_priority_issues },
    { name: 'low_priority_issues', value: input.low_priority_issues },
    { name: 'in_scope_count', value: input.in_scope_count },
    { name: 'out_of_scope_count', value: input.out_of_scope_count },
  ];

  for (const { name, value } of countFields) {
    if (value !== undefined) {
      if (!Number.isFinite(value)) {
        throw new ValidationError(`Invalid ${name}: ${value}. Must be a finite number.`);
      }
      if (!Number.isInteger(value)) {
        throw new ValidationError(`Invalid ${name}: ${value}. Must be an integer.`);
      }
      if (value < 0) {
        throw new ValidationError(`Invalid ${name}: ${value}. Must be non-negative.`);
      }
      // Check against MAX_SAFE_INTEGER to prevent precision loss
      if (!Number.isSafeInteger(value)) {
        logger.error('Issue count exceeds safe integer range - precision may be lost', {
          fieldName: name,
          value,
          maxSafeInteger: Number.MAX_SAFE_INTEGER,
        });
        throw new ValidationError(
          `Invalid ${name}: ${value}. Exceeds maximum safe integer (${Number.MAX_SAFE_INTEGER}). ` +
            `Review agent may have returned corrupted data.`
        );
      }
    }
  }

  // Validate count vs file array length consistency (new file-based format)
  if (input.in_scope_files || input.out_of_scope_files) {
    const inScopeFiles = input.in_scope_files ?? [];
    const outOfScopeFiles = input.out_of_scope_files ?? [];

    if (input.in_scope_count !== undefined && input.in_scope_count !== inScopeFiles.length) {
      throw new ValidationError(
        `in_scope_count (${input.in_scope_count}) does not match in_scope_files length (${inScopeFiles.length}). ` +
          `Agent may have reported incorrect count or missing files.`
      );
    }
    if (
      input.out_of_scope_count !== undefined &&
      input.out_of_scope_count !== outOfScopeFiles.length
    ) {
      throw new ValidationError(
        `out_of_scope_count (${input.out_of_scope_count}) does not match out_of_scope_files length (${outOfScopeFiles.length}). ` +
          `Agent may have reported incorrect count or missing files.`
      );
    }
  }

  // Calculate total with validated values
  const rawTotal =
    (input.high_priority_issues ?? 0) +
    (input.medium_priority_issues ?? 0) +
    (input.low_priority_issues ?? 0) +
    inScopeCount +
    outOfScopeCount;

  // Final validation that total is sane (defense against floating point issues and overflow)
  if (!Number.isFinite(rawTotal) || rawTotal < 0) {
    throw new ValidationError(
      `Invalid issue count total (${rawTotal}). Individual counts: ` +
        `high=${input.high_priority_issues}, medium=${input.medium_priority_issues}, ` +
        `low=${input.low_priority_issues}, inScope=${inScopeCount}, outOfScope=${outOfScopeCount}`
    );
  }
  if (!Number.isSafeInteger(rawTotal)) {
    logger.error('Total issue count exceeds safe integer range', {
      rawTotal,
      maxSafeInteger: Number.MAX_SAFE_INTEGER,
      individualCounts: {
        high: input.high_priority_issues,
        medium: input.medium_priority_issues,
        low: input.low_priority_issues,
        inScope: inScopeCount,
        outOfScope: outOfScopeCount,
      },
    });
    throw new ValidationError(
      `Total issue count (${rawTotal}) exceeds maximum safe integer. ` +
        `Sum of individual counts produced invalid result.`
    );
  }

  const issues: IssueCounts = {
    high: input.high_priority_issues ?? inScopeCount,
    medium: input.medium_priority_issues ?? 0,
    low: input.low_priority_issues ?? outOfScopeCount,
    total: rawTotal,
  };

  const { title, body } = buildCommentContent(
    verbatimResponse,
    reviewStep,
    issues,
    config,
    state.wiggum.phase
  );

  // Only in-scope issues block progression
  const hasInScopeIssues = inScopeCount > 0 || (input.high_priority_issues ?? 0) > 0;
  const newState = buildNewState(state, reviewStep, hasInScopeIssues);

  const result = await postStateComment(state, newState, title, body);

  // TODO(#415): Add safe discriminated union access with type guards
  if (!result.success) {
    logger.error('Review state comment failed - halting workflow', {
      reviewType: config.reviewTypeLabel,
      reviewStep,
      reason: result.reason,
      isTransient: result.isTransient,
      phase: state.wiggum.phase,
      prNumber: state.pr.exists ? state.pr.number : undefined,
      issueNumber: state.issue.exists ? state.issue.number : undefined,
      reviewResults: issues,
    });

    const reviewResultsSummary = `**${config.reviewTypeLabel} Review Results (NOT persisted):**
- High Priority: ${issues.high}
- Medium Priority: ${issues.medium}
- Low Priority: ${issues.low}
- **Total: ${issues.total}**`;

    return {
      content: [
        {
          type: 'text',
          text: formatWiggumResponse({
            current_step: STEP_NAMES[reviewStep],
            step_number: reviewStep,
            iteration_count: newState.iteration,
            instructions: `ERROR: ${config.reviewTypeLabel} review completed successfully, but failed to post state comment due to ${result.reason}.

${reviewResultsSummary}

**IMPORTANT:** The review itself succeeded. You do NOT need to re-run the ${config.reviewTypeLabel.toLowerCase()} review.

**Why This Failed:**
The race condition fix (issue #388) requires posting review results to the ${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} as a state comment. This state persistence failed.

**Common Causes:**
- GitHub API rate limiting (HTTP 429)
- Network connectivity issues
- Temporary GitHub API unavailability
- ${state.wiggum.phase === 'phase1' ? 'Issue' : 'PR'} does not exist or was closed

**Retry Instructions:**
1. Check rate limits: \`gh api rate_limit\`
2. Verify network connectivity: \`curl -I https://api.github.com\`
3. Confirm the ${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} exists: \`gh ${state.wiggum.phase === 'phase1' ? 'issue' : 'pr'} view ${state.wiggum.phase === 'phase1' ? (state.issue.exists ? state.issue.number : '<issue-number>') : state.pr.exists ? state.pr.number : '<pr-number>'}\`
4. Once resolved, retry this tool call with the SAME parameters

The workflow will resume from this step once the state comment posts successfully.`,
            steps_completed_by_tool: [
              `Executed ${config.reviewTypeLabel.toLowerCase()} review successfully`,
              'Attempted to post state comment',
              'Failed due to transient error - review results NOT persisted',
            ],
            context: {
              pr_number: state.pr.exists ? state.pr.number : undefined,
              issue_number: state.issue.exists ? state.issue.number : undefined,
              review_type: config.reviewTypeLabel,
              ...issues,
            },
          }),
        },
      ],
      isError: true,
    };
  }

  if (newState.iteration >= MAX_ITERATIONS) {
    return buildIterationLimitResponse(state, reviewStep, issues, newState.iteration);
  }

  // CRITICAL: Only hasInScopeIssues blocks progression
  if (hasInScopeIssues) {
    return buildIssuesFoundResponse(
      state,
      reviewStep,
      issues,
      newState.iteration,
      config,
      inScopeCount,
      outOfScopeCount,
      input.in_scope_files,
      input.out_of_scope_files
    );
  }

  // No in-scope issues: step is complete, but check for out-of-scope recommendations
  const hasOutOfScopeIssues = outOfScopeCount > 0;

  if (hasOutOfScopeIssues) {
    // Step is marked complete (newState already posted), but we need to track out-of-scope issues
    const issueNumber = state.issue.exists ? state.issue.number : undefined;
    const outOfScopeFiles = input.out_of_scope_files ?? [];

    // Reuse the newState we just posted to avoid race condition with GitHub API (issue #388)
    const updatedState = applyWiggumState(state, newState);

    // Return instructions to track out-of-scope issues, then proceed to next step
    const outOfScopeInstructions = generateOutOfScopeTrackingInstructions(
      issueNumber,
      config.reviewTypeLabel,
      outOfScopeCount,
      outOfScopeFiles
    );

    const output = {
      current_step: STEP_NAMES[reviewStep],
      step_number: reviewStep,
      iteration_count: newState.iteration,
      instructions: `${outOfScopeInstructions}\n\nAfter tracking out-of-scope recommendations, the workflow will automatically proceed to the next step.`,
      steps_completed_by_tool: [
        `Executed ${config.reviewTypeLabel.toLowerCase()} review`,
        state.wiggum.phase === 'phase1' ? 'Posted results to issue' : 'Posted results to PR',
        'Marked step as complete (no in-scope issues)',
      ],
      context: {
        pr_number: state.wiggum.phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
        issue_number: issueNumber,
        in_scope_issues: inScopeCount,
        out_of_scope_recommendations: outOfScopeCount,
      },
      next_step: await getNextStepInstructions(updatedState),
    };

    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }

  // No in-scope or out-of-scope issues: advance to next step
  // Reuse the newState we just posted to avoid race condition with GitHub API (issue #388)
  // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
  // state changes have occurred (PR closed, commits added, issue modified). This is safe
  // during inline step transitions within the same tool call. For state staleness validation,
  // see issue #391.
  const updatedState = applyWiggumState(state, newState);
  return await getNextStepInstructions(updatedState);
}
