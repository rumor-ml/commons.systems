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
  safeUpdatePRBodyState,
  safeUpdateIssueBodyState,
  type StateUpdateResult,
} from '../state/router.js';
import {
  addToCompletedSteps,
  applyWiggumState,
  isIterationLimitReached,
  getEffectiveMaxIterations,
} from '../state/state-utils.js';
import {
  STEP_NAMES,
  generateOutOfScopeTrackingInstructions,
  generateScopeSeparatedFixInstructions,
  generateIterationLimitInstructions,
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
 * LIMITATION: Acronyms are not specially handled. 'pr-test-analyzer' becomes
 * 'Pr Test Analyzer' instead of 'PR Test Analyzer'. This trade-off avoids
 * maintaining an acronym whitelist while providing consistent, predictable
 * capitalization for logging and display purposes.
 *
 * @param filePath - Full path to the review output file
 * @returns Human-readable agent name, or 'Unknown Agent (filename)' if parsing fails
 *
 * @example
 * extractAgentNameFromPath('$(pwd)/tmp/wiggum/code-reviewer-in-scope-1234.md')
 * // Returns: 'Code Reviewer'
 */
export function extractAgentNameFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop() || '';

  // Match pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}.md
  const match = fileName.match(/^(.+?)-(in-scope|out-of-scope)-\d+\.md$/);

  if (!match) {
    // Pattern didn't match - file name is malformed
    // Log at ERROR level and throw to prevent masking file naming violations
    logger.error('Failed to extract agent name from file path - file naming convention violated', {
      filePath,
      fileName,
      expectedPattern: '{agent-name}-(in-scope|out-of-scope)-{timestamp}.md',
      impact: 'Cannot attribute review findings to specific agent',
      action: 'Fix agent file naming to match convention',
    });
    throw new ValidationError(
      `Invalid review result filename: ${fileName}\n` +
        `Expected pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}.md\n` +
        `File path: ${filePath}\n\n` +
        `This indicates a bug in the review agent file naming logic.`
    );
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
 * Node.js file system error codes for file operations
 *
 * Covers the most common file I/O errors in production usage. This list is
 * intentionally limited to errors we've observed and handle specifically.
 * Unknown error codes are logged with warnings (see createFileReadError).
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
 * Immutable error object with readonly fields to prevent accidental modification
 * during error propagation and multi-step error handling. The category field
 * uses a string literal union for type-safe discrimination between in-scope
 * and out-of-scope file errors.
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
  // Validate path follows expected pattern before deriving category
  // Pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}.md
  const pathPattern = /-(?:in-scope|out-of-scope)-\d+\.md$/;
  if (!pathPattern.test(filePath)) {
    logger.warn('createFileReadError: filePath does not match expected pattern', {
      filePath,
      expectedPattern: '{agent-name}-(in-scope|out-of-scope)-{timestamp}.md',
      impact: 'Category derivation may be incorrect',
      action: 'Verify file naming convention is correct',
    });
  }

  // Derive category from file path pattern
  const category: 'in-scope' | 'out-of-scope' = filePath.includes('-in-scope-')
    ? 'in-scope'
    : 'out-of-scope';

  const nodeError = error as NodeJS.ErrnoException;

  // Validate error code against known Node.js file system error codes
  // Only include errorCode if it's a recognized code
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

  let errorCode: NodeFileErrorCode | undefined;
  if (nodeError.code) {
    if (knownErrorCodes.includes(nodeError.code as NodeFileErrorCode)) {
      errorCode = nodeError.code as NodeFileErrorCode;
    } else {
      // Unknown error code - log for future enumeration expansion
      logger.warn('createFileReadError: unknown error code encountered', {
        code: nodeError.code,
        filePath,
        action: 'Consider adding to NodeFileErrorCode enum if this error is common',
      });
    }
  }

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
 * Provides compile-time type safety to prevent passing empty strings.
 * Runtime validation via createNonEmptyString() is still required at
 * boundaries where untrusted data enters the system.
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

    if (stats.size === 0) {
      const agentName = extractAgentNameFromPath(filePath);
      // Provide multiple possible causes instead of assuming crash
      // Empty files can result from various conditions
      logger.error('Review file is empty - multiple possible causes', {
        filePath,
        agentName,
        possibleCauses: [
          'Agent crashed or was killed during write',
          'Agent found no issues and wrote empty file (check agent logs)',
          'Disk space exhausted during write (check: df -h)',
          'Race condition: Agent still writing (retry after delay)',
          'Agent validation error prevented write (check agent stderr)',
        ],
        impact: 'Review results incomplete - missing agent output',
        action: 'Check agent logs and file system for root cause',
      });

      const emptyFileError = new Error(
        `Review file is empty. Possible causes: ` +
          `(1) Agent ${agentName} crashed during write, ` +
          `(2) No issues found (check agent logs), ` +
          `(3) Disk space exhausted, ` +
          `(4) Still writing (retry). ` +
          `Check agent logs and 'df -h' to diagnose.`
      );
      const fileError = createFileReadError(filePath, emptyFileError, true, 0);
      errors.push(fileError);
      return null;
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
    } catch (statError) {
      // Log stat failure for debugging - this helps distinguish permission vs existence issues
      logger.debug('stat() failed during file read error recovery', {
        filePath,
        originalError: errorObj.message,
        statError: statError instanceof Error ? statError.message : String(statError),
        statErrorCode: (statError as NodeJS.ErrnoException).code,
        impact: 'Cannot determine if file exists or has permission issues',
      });
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
 * Result from loadReviewResults including formatted content and warnings
 */
export interface LoadReviewResultsOutput {
  /** Formatted in-scope review results with agent headers */
  readonly inScope: string;
  /** Formatted out-of-scope review results with agent headers */
  readonly outOfScope: string;
  /** Warnings about data completeness (e.g., out-of-scope file failures) */
  readonly warnings: readonly string[];
}

/**
 * Load review results from scope-separated file lists
 *
 * Reads multiple review result files and aggregates them with agent headers.
 * Collects errors from all file reads and provides comprehensive error context
 * if any files fail to read. Includes error codes and file metadata for diagnostics.
 *
 * In-scope file failures are fatal (throw ValidationError).
 * Out-of-scope file failures are non-fatal but return warnings to inform users.
 *
 * @param inScopeFiles - Array of file paths containing in-scope review results
 * @param outOfScopeFiles - Array of file paths containing out-of-scope review results
 * @returns Object with formatted in-scope/out-of-scope sections and any warnings
 * @throws {ValidationError} If in-scope files fail to read, with details of all failures
 *
 * @example
 * // Load results from multiple agent files
 * const { inScope, outOfScope, warnings } = await loadReviewResults(
 *   ['$(pwd)/tmp/wiggum-625/code-reviewer-in-scope-1234.md'],
 *   ['$(pwd)/tmp/wiggum-625/code-reviewer-out-of-scope-1234.md']
 * );
 * if (warnings.length > 0) {
 *   console.warn('Review data incomplete:', warnings.join('\n'));
 * }
 */
export async function loadReviewResults(
  inScopeFiles: readonly string[] = [],
  outOfScopeFiles: readonly string[] = []
): Promise<LoadReviewResultsOutput> {
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

  // Tiered failure handling: in-scope failures are fatal, out-of-scope are warnings
  const warnings: string[] = [];

  if (errors.length > 0) {
    const inScopeErrors = errors.filter((e) => e.category === 'in-scope');
    const outOfScopeErrors = errors.filter((e) => e.category === 'out-of-scope');

    // CRITICAL: Any in-scope file failure is fatal - these are required for the workflow
    if (inScopeErrors.length > 0) {
      const errorDetails = inScopeErrors
        .map(({ filePath, error, category, errorCode, fileExists, fileSize }) => {
          const code = errorCode ? ` [${errorCode}]` : '';
          const existence =
            fileExists !== undefined
              ? ` (exists: ${fileExists}, size: ${fileSize ?? 'unknown'})`
              : '';
          return `  - [${category}] ${filePath}${code}: ${error.message}${existence}`;
        })
        .join('\n');

      // Collect failed file paths for set operations
      const failedPaths = new Set(inScopeErrors.map((e) => e.filePath));
      const successfulInScope = inScopeFiles.filter((f) => !failedPaths.has(f));

      // Classify errors to help user decide action
      const hasPermissionErrors = inScopeErrors.some((e) => e.errorCode === 'EACCES');
      const hasMissingFiles = inScopeErrors.some((e) => e.errorCode === 'ENOENT');
      const hasEmptyFiles = inScopeErrors.some((e) => e.fileExists && e.fileSize === 0);

      let actionHint = '';
      if (hasMissingFiles) {
        actionHint =
          '\nAction: Check that review agents completed successfully before calling this tool.';
      } else if (hasPermissionErrors) {
        actionHint = '\nAction: Fix file permissions and retry.';
      } else if (hasEmptyFiles) {
        actionHint = '\nAction: Review agents may have crashed during write - check agent logs.';
      }

      logger.error('Critical: In-scope review file loading failed', {
        inScopeErrorCount: inScopeErrors.length,
        totalInScopeFiles: inScopeFiles.length,
        successfulInScopeCount: successfulInScope.length,
        failedFiles: inScopeErrors.map((e) => ({
          path: e.filePath,
          code: e.errorCode,
        })),
        hasPermissionErrors,
        hasMissingFiles,
        hasEmptyFiles,
      });

      throw new ValidationError(
        `Failed to read ${inScopeErrors.length} in-scope review file(s) (CRITICAL):\n${errorDetails}${actionHint}`
      );
    }

    // WARN: Out-of-scope failures are non-fatal - workflow can proceed with degraded tracking
    // Add warning to return value so callers can surface it to users
    if (outOfScopeErrors.length > 0) {
      const failedFileNames = outOfScopeErrors.map((e) => e.filePath.split('/').pop()).join(', ');
      const warningMsg =
        `Warning: ${outOfScopeErrors.length} out-of-scope review file(s) failed to load. ` +
        `Out-of-scope recommendations may be incomplete. ` +
        `Failed files: ${failedFileNames}`;

      warnings.push(warningMsg);
      logger.warn('Out-of-scope review files failed to load - proceeding with degraded tracking', {
        outOfScopeErrorCount: outOfScopeErrors.length,
        totalOutOfScopeFiles: outOfScopeFiles.length,
        successfulOutOfScope: outOfScopeResults.length,
        impact: 'Out-of-scope recommendations may be incomplete',
        failedFiles: outOfScopeErrors.map((e) => ({
          path: e.filePath,
          code: e.errorCode,
          reason: e.error.message,
        })),
      });
      // Continue execution with whatever out-of-scope data we successfully loaded
    }
  }

  return {
    inScope: inScopeResults.length > 0 ? `## In-Scope Issues\n\n${inScopeResults.join('\n')}` : '',
    outOfScope:
      outOfScopeResults.length > 0
        ? `## Out-of-Scope Recommendations\n\n${outOfScopeResults.join('\n')}`
        : '',
    warnings,
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
 * **IMPORTANT: Issue counts vs file counts**
 * in_scope_count and out_of_scope_count represent the number of ISSUES found,
 * not the number of FILES. Each file may contain multiple issues from one agent.
 * We validate file array non-emptiness when counts > 0, but do NOT validate
 * that issue counts equal file counts.
 *
 * **Numeric validation:**
 * Counts are validated as safe non-negative integers to prevent overflow and
 * precision loss in downstream arithmetic operations.
 *
 * **command_executed constraint:**
 * Must be true (literal) to prevent agents from skipping the review process.
 * Schema rejects false values with an actionable error message.
 */
export const ReviewCompletionInputSchema = z
  .object({
    command_executed: z.literal(true, {
      errorMap: () => ({
        message:
          'command_executed must be true. The review command must be executed before calling this tool. ' +
          'Do not shortcut the review process.',
      }),
    }),
    in_scope_files: z.array(z.string().min(1, 'File path cannot be empty')),
    out_of_scope_files: z.array(z.string().min(1, 'File path cannot be empty')),
    in_scope_count: z
      .number()
      .int()
      .nonnegative()
      .refine(Number.isFinite, { message: 'in_scope_count must be finite (not Infinity or NaN)' })
      .refine(Number.isSafeInteger, {
        message: 'in_scope_count must be a safe integer (within MAX_SAFE_INTEGER)',
      }),
    out_of_scope_count: z
      .number()
      .int()
      .nonnegative()
      .refine(Number.isFinite, {
        message: 'out_of_scope_count must be finite (not Infinity or NaN)',
      })
      .refine(Number.isSafeInteger, {
        message: 'out_of_scope_count must be a safe integer (within MAX_SAFE_INTEGER)',
      }),
    maxIterations: z
      .number()
      .int()
      .positive('maxIterations must be a positive integer')
      .refine(Number.isFinite, { message: 'maxIterations must be finite (not Infinity or NaN)' })
      .refine(Number.isSafeInteger, {
        message: 'maxIterations must be a safe integer (within MAX_SAFE_INTEGER)',
      })
      .optional(),
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
 * **IMPORTANT: Issue counts vs file counts**
 * in_scope_count and out_of_scope_count represent the number of ISSUES,
 * not FILES. A single file may contain multiple issues from one agent.
 *
 * @see ReviewCompletionInputSchema for complete validation rules
 */
export interface ReviewCompletionInput {
  /** Must be true - enforced by schema to prevent skipping review */
  readonly command_executed: true;
  readonly in_scope_files: readonly string[];
  readonly out_of_scope_files: readonly string[];
  readonly in_scope_count: number;
  readonly out_of_scope_count: number;
  readonly maxIterations?: number;
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
  hasInScopeIssues: boolean,
  maxIterations?: number
): WiggumState {
  // Only increment iteration for in-scope issues
  if (hasInScopeIssues) {
    return {
      iteration: currentState.wiggum.iteration + 1,
      step: reviewStep,
      completedSteps: currentState.wiggum.completedSteps,
      phase: currentState.wiggum.phase,
      maxIterations: maxIterations ?? currentState.wiggum.maxIterations,
    };
  }

  // If no in-scope issues (even if out-of-scope exist), mark complete
  return {
    iteration: currentState.wiggum.iteration,
    step: reviewStep,
    completedSteps: addToCompletedSteps(currentState.wiggum.completedSteps, reviewStep),
    phase: currentState.wiggum.phase,
    maxIterations: maxIterations ?? currentState.wiggum.maxIterations,
  };
}

/**
 * Sleep helper for retry delays
 */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry state update with exponential backoff for transient failures
 *
 * Automatically retries state updates that fail due to transient issues like
 * rate limits or network hiccups. Uses exponential backoff (2s, 4s, 8s) to
 * reduce load during outages while giving issues time to resolve.
 *
 * @param state - Current state object
 * @param newState - New state to update
 * @param maxRetries - Maximum retry attempts (default: 3, must be >= 1)
 * @returns StateUpdateResult after retries exhausted or success
 * @throws {ValidationError} If maxRetries is not a positive integer
 */
async function retryStateUpdate(
  state: CurrentState,
  newState: {
    iteration: number;
    step: WiggumStep;
    completedSteps: readonly WiggumStep[];
    phase: WiggumPhase;
  },
  maxRetries = 3
): Promise<StateUpdateResult> {
  // Validate maxRetries to ensure loop executes at least once
  // Prevents edge case where maxRetries < 1 would skip the loop entirely
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    throw new ValidationError(
      `retryStateUpdate: maxRetries must be a positive integer, got: ${maxRetries}`
    );
  }

  // DO NOT initialize result here - force every code path to set it
  // This prevents returning a misleading placeholder error that says "network failure"
  // when no network call was actually attempted.
  let result: StateUpdateResult | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    result = await updateBodyState(state, newState);

    if (result.success) {
      if (attempt > 1) {
        logger.info('State update succeeded after retry', {
          attempt,
          maxRetries,
          phase: state.wiggum.phase,
        });
      }
      return result;
    }

    // Only retry for transient failures
    if (!result.isTransient || attempt === maxRetries) {
      logger.warn('State update failed - not retrying', {
        attempt,
        maxRetries,
        reason: result.reason,
        isTransient: result.isTransient,
      });
      return result;
    }

    // Exponential backoff: 2s, 4s, 8s
    const delayMs = Math.pow(2, attempt) * 1000;
    logger.info('State update failed (transient), retrying', {
      attempt,
      maxRetries,
      delayMs,
      reason: result.reason,
    });
    await sleepMs(delayMs);
  }

  // TypeScript control flow: This should be unreachable, but throw instead of returning fake error.
  // Runtime guarantee: maxRetries >= 1 (validated above) ensures the loop executes at least once,
  // and every iteration either returns or continues. This indicates a programming error if reached.
  throw new Error(
    `INTERNAL ERROR: retryStateUpdate loop completed without returning. ` +
      `This indicates a programming error in retry logic. ` +
      `maxRetries=${maxRetries}, phase=${state.wiggum.phase}, lastResult=${JSON.stringify(result)}`
  );
}

/**
 * Update state in issue body (phase1) or PR body (phase2)
 */
async function updateBodyState(
  state: CurrentState,
  newState: {
    iteration: number;
    step: WiggumStep;
    completedSteps: readonly WiggumStep[];
    phase: WiggumPhase;
  }
): Promise<StateUpdateResult> {
  if (state.wiggum.phase === 'phase1') {
    if (!state.issue.exists || !state.issue.number) {
      // TODO(#312): Add Sentry error ID for tracking
      throw new ValidationError(
        'Internal error: Phase 1 requires issue number, but validation passed with no issue'
      );
    }
    return await safeUpdateIssueBodyState(state.issue.number, newState, newState.step);
  } else {
    if (!state.pr.exists || !state.pr.number) {
      // TODO(#312): Add Sentry error ID for tracking
      throw new ValidationError(
        'Internal error: Phase 2 requires PR number, but validation passed with no PR'
      );
    }
    return await safeUpdatePRBodyState(state.pr.number, newState, newState.step);
  }
}

/**
 * Build iteration limit response
 */
function buildIterationLimitResponse(
  state: CurrentState,
  reviewStep: WiggumStep,
  issues: IssueCounts,
  newState: WiggumState
): ToolResult {
  const effectiveLimit = getEffectiveMaxIterations(newState);
  const output = {
    current_step: STEP_NAMES[reviewStep],
    step_number: reviewStep,
    iteration_count: newState.iteration,
    instructions: generateIterationLimitInstructions(newState, effectiveLimit),
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

// NOTE: validateSafeNonNegativeInteger was removed since Zod schema (ReviewCompletionInputSchema)
// now handles all numeric validation for in_scope_count and out_of_scope_count.
// All callers now use completeReview() which validates input via ReviewCompletionInputSchema.

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
  // Schema validates command_executed === true, count/file relationships, and numeric constraints
  try {
    ReviewCompletionInputSchema.parse(input);
  } catch (error) {
    const zodError = error instanceof Error ? error : new Error(String(error));
    throw new ValidationError(`Review completion input validation failed: ${zodError.message}`);
  }

  // command_executed is validated by schema to be literal true - no additional check needed

  // Load review results from scope-separated files
  // Capture warnings to surface data completeness issues to users (e.g., out-of-scope file failures)
  const { warnings: loadWarnings } = await loadReviewResults(
    input.in_scope_files,
    input.out_of_scope_files
  );

  // Log any warnings from file loading - these indicate potentially incomplete review data
  // (e.g., out-of-scope files that failed to load, empty files, etc.)
  if (loadWarnings.length > 0) {
    logger.warn('Review result loading completed with warnings', {
      warningCount: loadWarnings.length,
      warnings: loadWarnings,
      reviewType: config.reviewTypeLabel,
      impact: 'Some review data may be incomplete - check warnings for details',
    });
  }

  const state = await detectCurrentState();
  const reviewStep = getReviewStep(state.wiggum.phase, config);

  validatePhaseRequirements(state, config);

  // NOTE: Zod schema (ReviewCompletionInputSchema) already validates that in_scope_count
  // and out_of_scope_count are non-negative safe integers. No additional validation needed.
  const inScopeCount = input.in_scope_count;
  const outOfScopeCount = input.out_of_scope_count;

  // NOTE: in_scope_count and out_of_scope_count represent the number of ISSUES,
  // not the number of FILES. Each file can contain multiple issues from one agent.
  // We validate that files exist and are readable in loadReviewResults(), but we
  // do NOT validate that issue counts match file counts.

  // Sum of two safe non-negative integers is always a safe non-negative integer
  // (MAX_SAFE_INTEGER + MAX_SAFE_INTEGER < Number.MAX_VALUE, no overflow possible)
  const rawTotal = inScopeCount + outOfScopeCount;

  const issues: IssueCounts = {
    high: inScopeCount,
    medium: 0,
    low: outOfScopeCount,
    total: rawTotal,
  };

  // Only in-scope issues block progression
  const hasInScopeIssues = inScopeCount > 0;
  const newState = buildNewState(state, reviewStep, hasInScopeIssues, input.maxIterations);

  // Use retry logic with exponential backoff for transient failures
  const result = await retryStateUpdate(state, newState);

  // TODO(#415): Add safe discriminated union access with type guards
  if (!result.success) {
    logger.error('Review state update failed after retries - halting workflow', {
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
            instructions: `ERROR: ${config.reviewTypeLabel} review completed successfully, but failed to update state in ${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} body after automatic retries. Reason: ${result.reason}.

${reviewResultsSummary}

**IMPORTANT:** The review itself succeeded. You do NOT need to re-run the ${config.reviewTypeLabel.toLowerCase()} review.

**Why This Failed:**
The race condition fix (issue #388) requires persisting review results to the ${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} body. This state persistence failed even after automatic retry attempts with exponential backoff.

**Common Causes:**
- GitHub API rate limiting (HTTP 429) - persistent or severe
- Network connectivity issues
- Extended GitHub API unavailability
- ${state.wiggum.phase === 'phase1' ? 'Issue' : 'PR'} does not exist or was closed

**Manual Retry Instructions:**
1. Check rate limits: \`gh api rate_limit\`
2. Verify network connectivity: \`curl -I https://api.github.com\`
3. Confirm the ${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} exists: \`gh ${state.wiggum.phase === 'phase1' ? 'issue' : 'pr'} view ${state.wiggum.phase === 'phase1' ? (state.issue.exists ? state.issue.number : '<issue-number>') : state.pr.exists ? state.pr.number : '<pr-number>'}\`
4. Wait a few minutes for transient issues to resolve
5. Retry this tool call with the SAME parameters

The workflow will resume from this step once the state update succeeds.`,
            steps_completed_by_tool: [
              `Executed ${config.reviewTypeLabel.toLowerCase()} review successfully`,
              'Attempted to update state in body (with automatic retries)',
              'Failed after all retry attempts - review results NOT persisted',
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

  if (isIterationLimitReached(newState)) {
    return buildIterationLimitResponse(state, reviewStep, issues, newState);
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
