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
 * letter of each word.
 *
 * NOTE: Acronyms like 'pr' become 'Pr' not 'PR'. This is intentional - we use
 * simple word-based capitalization without maintaining an acronym whitelist.
 * The alternative would require hardcoding acronyms (PR, API, HTTP, etc.) which
 * adds complexity and maintenance burden. Current approach is consistent and
 * predictable: every word gets first letter capitalized, rest lowercase.
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
 * // Returns: 'Pr Test Analyzer' (intentionally 'Pr' not 'PR' - see NOTE above)
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
 * Node.js file system error codes
 *
 * Common error codes from Node.js fs operations. This is not exhaustive
 * but covers the most common file I/O errors.
 */
type NodeFileErrorCode =
  | 'EACCES' // Permission denied
  | 'ENOENT' // No such file or directory
  | 'EISDIR' // Is a directory (expected file)
  | 'ENOTDIR' // Not a directory (expected directory)
  | 'EMFILE' // Too many open files (process limit)
  | 'ENFILE' // Too many open files (system limit)
  | 'ENOSPC' // No space left on device
  | 'EROFS'; // Read-only file system

/**
 * Enhanced file read error with diagnostic information
 *
 * All fields are readonly since error information is immutable after creation.
 * The category field uses a string literal union for type-safe discrimination
 * between in-scope and out-of-scope file errors.
 */
interface FileReadError {
  readonly filePath: string;
  readonly error: Error;
  readonly category: 'in-scope' | 'out-of-scope';
  readonly errorCode?: NodeFileErrorCode;
  readonly fileExists?: boolean;
  readonly fileSize?: number;
}

/**
 * Create a FileReadError with category derived from file path
 *
 * Factory function that automatically determines the category (in-scope vs out-of-scope)
 * based on the file path naming convention, and extracts Node.js error codes.
 *
 * @param filePath - Path to the file that failed to read
 * @param error - The error that occurred
 * @param fileExists - Whether the file exists (for diagnostics)
 * @param fileSize - Size of the file if it exists (for diagnostics)
 * @returns FileReadError with all fields populated
 */
function createFileReadError(
  filePath: string,
  error: Error,
  fileExists?: boolean,
  fileSize?: number
): FileReadError {
  // Derive category from file path pattern
  const category: 'in-scope' | 'out-of-scope' = filePath.includes('-in-scope-')
    ? 'in-scope'
    : 'out-of-scope';

  const nodeError = error as NodeJS.ErrnoException;

  // Validate error code against known Node.js file system error codes
  // Only include errorCode if it's a recognized code, discard unknown codes
  const knownErrorCodes: readonly NodeFileErrorCode[] = [
    'EACCES',
    'ENOENT',
    'EISDIR',
    'ENOTDIR',
    'EMFILE',
    'ENFILE',
    'ENOSPC',
    'EROFS',
  ];
  const errorCode: NodeFileErrorCode | undefined =
    nodeError.code && knownErrorCodes.includes(nodeError.code as NodeFileErrorCode)
      ? (nodeError.code as NodeFileErrorCode)
      : undefined;

  return {
    filePath,
    error,
    category,
    errorCode,
    fileExists,
    fileSize,
  };
}

/**
 * Branded type for non-empty strings
 *
 * This ensures at the type level that content strings are non-empty.
 * The brand is a phantom type that exists only at compile time.
 */
type NonEmptyString = string & { readonly __brand: 'NonEmptyString' };

/**
 * Create a NonEmptyString with runtime validation
 *
 * @param value - String value to validate
 * @returns NonEmptyString if validation passes
 * @throws {Error} If string is empty or whitespace-only
 */
function createNonEmptyString(value: string): NonEmptyString {
  if (value.trim().length === 0) {
    throw new Error('File is empty - review agent may not have completed');
  }
  return value as NonEmptyString;
}

/**
 * Result of reading a single review file
 */
interface ReviewFileReadResult {
  readonly success: true;
  readonly agentName: string;
  readonly content: NonEmptyString;
}

/**
 * Read a single review file with comprehensive error handling
 *
 * Handles file reading, empty file detection, and error metadata collection.
 * Returns either a success result with content or null (with error pushed to errors array).
 *
 * @param filePath - Path to the review file
 * @param category - Category label for logging ('in-scope' or 'out-of-scope')
 * @param errors - Array to collect any file read errors
 * @returns ReviewFileReadResult on success, null on failure
 */
async function readReviewFile(
  filePath: string,
  category: 'in-scope' | 'out-of-scope',
  errors: FileReadError[]
): Promise<ReviewFileReadResult | null> {
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

    // Validate content is non-empty and create branded NonEmptyString
    // This ensures type-level guarantee that content is never empty
    const nonEmptyContent = createNonEmptyString(content);

    return {
      success: true,
      agentName: extractAgentNameFromPath(filePath),
      content: nonEmptyContent,
    };
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));

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

    const fileError = createFileReadError(filePath, errorObj, fileExists, fileSize);
    errors.push(fileError);

    logger.error(`Failed to read ${category} review file`, {
      filePath,
      errorMessage: errorObj.message,
      errorCode: fileError.errorCode,
      errorStack: errorObj.stack,
      fileExists,
      fileSize,
    });

    return null;
  }
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
  inScopeFiles: readonly string[] = [],
  outOfScopeFiles: readonly string[] = []
): Promise<{ inScope: string; outOfScope: string }> {
  const errors: FileReadError[] = [];

  // Read all in-scope files
  const inScopeResults: string[] = [];
  for (const filePath of inScopeFiles) {
    const result = await readReviewFile(filePath, 'in-scope', errors);
    if (result) {
      inScopeResults.push(`#### ${result.agentName}\n\n${result.content}\n\n---\n`);
    }
  }

  // Read all out-of-scope files
  const outOfScopeResults: string[] = [];
  for (const filePath of outOfScopeFiles) {
    const result = await readReviewFile(filePath, 'out-of-scope', errors);
    if (result) {
      outOfScopeResults.push(`#### ${result.agentName}\n\n${result.content}\n\n---\n`);
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
 * Zod schema for ReviewConfig runtime validation
 *
 * Validates that step identifiers match their expected phases:
 * - phase1Step must start with 'p1-'
 * - phase2Step must start with 'p2-'
 */
export const ReviewConfigSchema = z
  .object({
    phase1Step: z.string(),
    phase2Step: z.string(),
    phase1Command: z.string(),
    phase2Command: z.string(),
    reviewTypeLabel: z.string(),
    issueTypeLabel: z.string(),
    successMessage: z.string(),
  })
  .refine(
    (data) => {
      return data.phase1Step.startsWith('p1-');
    },
    {
      message:
        "phase1Step must start with 'p1-' prefix (e.g., 'p1-pr-review', 'p1-security-review')",
    }
  )
  .refine(
    (data) => {
      return data.phase2Step.startsWith('p2-');
    },
    {
      message:
        "phase2Step must start with 'p2-' prefix (e.g., 'p2-pr-review', 'p2-security-review')",
    }
  );

/**
 * Configuration for a review type (PR or Security)
 *
 * All fields are readonly since configuration should be immutable once created.
 */
export interface ReviewConfig {
  /** Step identifier for Phase 1 */
  readonly phase1Step: WiggumStep;
  /** Step identifier for Phase 2 */
  readonly phase2Step: WiggumStep;
  /** Command for Phase 1 */
  readonly phase1Command: string;
  /** Command for Phase 2 */
  readonly phase2Command: string;
  /** Type label for logging and messages (e.g., "PR", "Security") */
  readonly reviewTypeLabel: string;
  /** Issue type for messages (e.g., "issue(s)", "security issue(s)") */
  readonly issueTypeLabel: string;
  /** Success message for when no issues found */
  readonly successMessage: string;
}

/**
 * Validates ReviewConfig data
 *
 * Ensures step identifiers match expected phase prefixes and all required fields are present.
 *
 * @throws {z.ZodError} If validation fails with detailed error information
 */
export function validateReviewConfig(config: unknown): ReviewConfig {
  return ReviewConfigSchema.parse(config) as ReviewConfig;
}

/**
 * Zod schema for ReviewCompletionInput runtime validation
 *
 * Issue counts are validated at schema level to be integers (no decimals) >= 0.
 * File paths are validated to be non-empty strings to catch empty path errors early.
 * Note: Zod .int().nonnegative() does not validate against Infinity, NaN, or
 * unsafe integers exceeding Number.MAX_SAFE_INTEGER. Additional runtime validation
 * in completeReview() provides comprehensive checks including finite/safe integer validation.
 *
 * Refinements enforce relationship between counts and file arrays:
 * - If in_scope_count > 0, then in_scope_files must be non-empty
 * - If out_of_scope_count > 0, then out_of_scope_files must be non-empty
 *
 * @see completeReview for complete validation including Infinity/NaN/overflow checks
 */
export const ReviewCompletionInputSchema = z
  .object({
    command_executed: z.boolean(),
    in_scope_files: z.array(z.string().min(1, 'File path cannot be empty')),
    out_of_scope_files: z.array(z.string().min(1, 'File path cannot be empty')),
    in_scope_count: z.number().int().nonnegative(),
    out_of_scope_count: z.number().int().nonnegative(),
  })
  .refine(
    (data) => {
      // If in_scope_count > 0, we must have at least one in_scope_files entry
      return data.in_scope_count === 0 || data.in_scope_files.length > 0;
    },
    {
      message:
        'in_scope_count is greater than 0 but in_scope_files is empty. ' +
        'If there are in-scope issues, file paths must be provided.',
    }
  )
  .refine(
    (data) => {
      // If out_of_scope_count > 0, we must have at least one out_of_scope_files entry
      return data.out_of_scope_count === 0 || data.out_of_scope_files.length > 0;
    },
    {
      message:
        'out_of_scope_count is greater than 0 but out_of_scope_files is empty. ' +
        'If there are out-of-scope issues, file paths must be provided.',
    }
  );

/**
 * Input for review completion
 *
 * All fields are readonly since this represents immutable input data.
 * Basic integer validation via Zod schema (.int().nonnegative()) catches decimals and negatives.
 * Complete validation in completeReview() adds: Infinity/NaN checks, safe integer validation,
 * count vs file array length consistency, and detailed error messages.
 *
 * @see ReviewCompletionInputSchema for Zod schema validation
 * @see completeReview for complete runtime validation
 */
export interface ReviewCompletionInput {
  readonly command_executed: boolean;
  readonly in_scope_files: readonly string[];
  readonly out_of_scope_files: readonly string[];
  readonly in_scope_count: number;
  readonly out_of_scope_count: number;
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
    completedSteps: readonly WiggumStep[];
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
  inScopeFiles?: readonly string[],
  outOfScopeFiles?: readonly string[]
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

  logger.info(
    `Providing parallel fix instructions for ${config.reviewTypeLabel.toLowerCase()} review issues`,
    {
      phase: state.wiggum.phase,
      issueNumber,
      totalIssues: issues.total,
      inScopeCount,
      outOfScopeCount,
      iteration: newIteration,
    }
  );

  const reviewTypeForTriage = config.reviewTypeLabel === 'Security' ? 'Security' : 'PR';

  // Launch 2 agents in parallel (triage already done by review agents)
  const instructions = generateScopeSeparatedFixInstructions(
    issueNumber,
    reviewTypeForTriage,
    inScopeCount,
    inScopeFiles!,
    outOfScopeCount,
    outOfScopeFiles ?? []
  );

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
 * Validate that a value is a non-negative safe integer
 *
 * Performs comprehensive validation for numeric values that must be:
 * - Finite (not Infinity or -Infinity)
 * - An integer (no decimal values)
 * - Non-negative (>= 0)
 * - Within safe integer range (prevents precision loss)
 *
 * @param value - The numeric value to validate
 * @param fieldName - Name of the field for error messages
 * @throws {ValidationError} If validation fails with descriptive message
 */
function validateSafeNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`Invalid ${fieldName}: ${value}. Must be a finite number.`);
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`Invalid ${fieldName}: ${value}. Must be an integer.`);
  }
  if (value < 0) {
    throw new ValidationError(`Invalid ${fieldName}: ${value}. Must be non-negative.`);
  }
  // Check against MAX_SAFE_INTEGER to prevent precision loss
  if (!Number.isSafeInteger(value)) {
    logger.error('Value exceeds safe integer range - precision may be lost', {
      fieldName,
      value,
      maxSafeInteger: Number.MAX_SAFE_INTEGER,
    });
    throw new ValidationError(
      `Invalid ${fieldName}: ${value}. Exceeds maximum safe integer (${Number.MAX_SAFE_INTEGER}). ` +
        `Review agent may have returned corrupted data.`
    );
  }
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
 * CRITICAL: Issue counts represent number of ISSUES, not FILES. Each file can contain
 * multiple issues from one agent. We validate files exist and are readable, but we do
 * NOT validate that issue counts match file counts. A single file may report 5 issues.
 *
 * @param input - Review completion input with issue counts and response
 * @param config - Configuration for the specific review type
 * @returns Tool result with next step instructions
 */
export async function completeReview(
  input: ReviewCompletionInput,
  config: ReviewConfig
): Promise<ToolResult> {
  // Validate input at entry point to catch invalid data early
  // This enforces count/file array relationships and basic type constraints
  try {
    ReviewCompletionInputSchema.parse(input);
  } catch (error) {
    const zodError = error instanceof Error ? error : new Error(String(error));
    throw new ValidationError(`Review completion input validation failed: ${zodError.message}`);
  }

  if (!input.command_executed) {
    // TODO(#312): Add Sentry error ID for tracking
    throw new ValidationError(
      `command_executed must be true. Do not shortcut the ${config.reviewTypeLabel.toLowerCase()} review process.`
    );
  }

  // Load review results from scope-separated files
  const { inScope, outOfScope } = await loadReviewResults(
    input.in_scope_files,
    input.out_of_scope_files
  );
  const sections = [inScope, outOfScope].filter(Boolean);
  const verbatimResponse = sections.join('\n\n');

  const state = await detectCurrentState();
  const reviewStep = getReviewStep(state.wiggum.phase, config);

  validatePhaseRequirements(state, config);

  const inScopeCount = input.in_scope_count;
  const outOfScopeCount = input.out_of_scope_count;

  // Validate all numeric counts are non-negative safe integers
  validateSafeNonNegativeInteger(inScopeCount, 'in_scope_count');
  validateSafeNonNegativeInteger(outOfScopeCount, 'out_of_scope_count');

  // NOTE: in_scope_count and out_of_scope_count represent the number of ISSUES,
  // not the number of FILES. Each file can contain multiple issues from one agent.
  // We validate that files exist and are readable in loadReviewResults(), but we
  // do NOT validate that issue counts match file counts.

  // Calculate total with validated values
  const rawTotal = inScopeCount + outOfScopeCount;

  // Final validation that total is sane (defense against overflow when summing valid counts)
  validateSafeNonNegativeInteger(rawTotal, 'total issue count');

  const issues: IssueCounts = {
    high: inScopeCount,
    medium: 0,
    low: outOfScopeCount,
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
  const hasInScopeIssues = inScopeCount > 0;
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
