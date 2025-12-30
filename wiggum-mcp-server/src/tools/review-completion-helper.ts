/**
 * Shared helper for PR review and security review completion tools
 *
 * This module extracts common logic from complete-pr-review.ts and
 * complete-security-review.ts to reduce duplication while preserving
 * the distinct behavior of each review type.
 *
 * TODO(#985): Consolidate verbose error handling patterns - consider extracting
 * diagnostic context building, file reading error handling, and state update
 * error responses into helper functions.
 */

// TODO(#1002): Overly verbose NodeFileErrorCode type and validation in review-completion-helper.ts
// TODO(#967): Extract shared validation for review file naming pattern
// TODO(#947): Improve naming consistency for state update functions
// TODO(#937): Include error codes in out-of-scope file loading warnings
// TODO(#929): Improve visibility of unknown agent names in review completion
// TODO(#908): Replace throwing error with Result type in extractAgentNameFromPath
// TODO(#906): Make KNOWN_AGENT_NAMES array immutable with 'as const'
// TODO(#905): Reduce comment verbosity in review file empty error message
// TODO(#877): Extract ReviewConfig schemas to dedicated schemas directory
// TODO(#876): Use structured data for LoadReviewResultsOutput instead of pre-formatted markdown strings
// TODO(#861): Prioritize empty file error causes with diagnostic checks
// TODO(#822): Improve extractAgentNameFromPath file naming validation to be more graceful for out-of-scope files
// TODO(#805): Improve file read error messages with specific action hints
// TODO(#790): Improve error handling for extractAgentNameFromPath ValidationError
// TODO(#782): Improve stat() error logging in readReviewFile error recovery
// TODO(#781): Fix acronym capitalization in extractAgentNameFromPath
// TODO(#739): Make KNOWN_AGENT_NAMES readonly and consider auto-generation
// TODO(#707): Improve agent name validation warnings with typo detection
import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import {
  getNextStepInstructions,
  safeUpdatePRBodyState,
  safeUpdateIssueBodyState,
  type StateUpdateResult,
} from '../state/router.js';
import {
  applyWiggumState,
  isIterationLimitReached,
  getEffectiveMaxIterations,
} from '../state/state-utils.js';
import { advanceToNextStep } from '../state/transitions.js';
import {
  STEP_NAMES,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
  PHASE1_PR_REVIEW_COMMAND,
  PHASE2_PR_REVIEW_COMMAND,
  SECURITY_REVIEW_COMMAND,
  generateOutOfScopeTrackingInstructions,
  generateScopeSeparatedFixInstructions,
  generateIterationLimitInstructions,
} from '../constants.js';
import type { WiggumStep, WiggumPhase } from '../constants.js';
import { ValidationError, FilesystemError, GitHubCliError } from '../utils/errors.js';
import { buildValidationErrorMessage } from '../utils/error-messages.js';
import type { ToolResult } from '../types.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { logger } from '../utils/logger.js';
import type { CurrentState, WiggumState } from '../state/types.js';
import { createWiggumState } from '../state/types.js';
import { readFile, stat } from 'fs/promises';
import { REVIEW_AGENT_NAMES, isReviewAgentName } from './manifest-utils.js';

/**
 * Extract agent name from file path
 *
 * Parses the wiggum output file naming convention to extract a human-readable
 * agent name. Converts kebab-case to Title Case by capitalizing the first
 * letter of each word.
 *
 * NOTE: Acronyms are treated the same as other words (e.g., 'pr-test-analyzer' becomes
 * 'Pr Test Analyzer'). This provides consistent formatting without maintaining an
 * acronym whitelist.
 * Currently used for display in GitHub comments and logs.
 *
 * @param filePath - Full path to the review output file
 * @returns Human-readable agent name, or 'Unknown Agent (filename)' if parsing fails
 *
 * @example
 * extractAgentNameFromPath('$(pwd)/tmp/wiggum/code-reviewer-in-scope-1234-abc123.md')
 * // Returns: 'Code Reviewer'
 */
export function extractAgentNameFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop() || '';

  // Match pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}-{random-suffix}.md
  // Random suffix prevents collisions when agents start simultaneously
  const match = fileName.match(/^(.+?)-(in-scope|out-of-scope)-\d+-[a-f0-9]+\.md$/);

  if (!match) {
    // Pattern didn't match - file name is malformed
    // Log at ERROR level and throw to prevent masking file naming violations
    logger.error('Failed to extract agent name from file path - file naming convention violated', {
      filePath,
      fileName,
      expectedPattern: '{agent-name}-(in-scope|out-of-scope)-{timestamp}-{random-suffix}.md',
      impact: 'Cannot attribute review findings to specific agent',
      action: 'Fix agent file naming to match convention',
    });
    throw new ValidationError(
      `Invalid review result filename: ${fileName}\n` +
        `Expected pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}-{random-suffix}.md\n` +
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
  // Uses isReviewAgentName type guard for compile-time and runtime type safety
  if (!isReviewAgentName(agentSlug)) {
    logger.warn('Extracted agent name not in known agents list', {
      filePath,
      extractedName: agentSlug,
      knownAgents: REVIEW_AGENT_NAMES,
      suggestion: 'Update ReviewAgentName type in manifest-types.ts if this is a new agent',
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
 * Covers file I/O errors that require specific handling or diagnostics in production.
 * This list is intentionally limited to errors we've observed and handle specifically
 * (e.g., permission errors get different recovery instructions than missing files).
 * Unknown error codes are logged with warnings (see createFileReadError function).
 *
 * **When to extend this enum:**
 * Add new codes when they require distinct error messages or recovery paths.
 * If a new error code should be handled the same as an existing one, no change needed.
 */
// TODO(#988): Consider adding NODE_FILE_ERROR_DESCRIPTIONS map and describeFileError helper
// for programmatic access to error descriptions at runtime
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
 * Base fields shared by all FileReadError variants
 */
interface FileReadErrorBase {
  readonly filePath: string;
  readonly error: Error;
  readonly category: 'in-scope' | 'out-of-scope';
  readonly errorCode?: NodeFileErrorCode;
}

/**
 * FileReadError without diagnostic information (stat() not attempted or failed)
 */
interface FileReadErrorNoDiagnostics extends FileReadErrorBase {
  readonly diagnosticsAvailable: false;
}

/**
 * FileReadError with diagnostic information from successful stat() call
 */
interface FileReadErrorWithDiagnostics extends FileReadErrorBase {
  readonly diagnosticsAvailable: true;
  readonly fileExists: boolean;
  readonly fileSize?: number; // Only meaningful when fileExists is true
}

/**
 * Enhanced file read error with optional diagnostic information
 *
 * Discriminated union on `diagnosticsAvailable`:
 * - When true: fileExists and fileSize are available
 * - When false: stat() was not attempted or failed
 */
type FileReadError = FileReadErrorNoDiagnostics | FileReadErrorWithDiagnostics;

/**
 * Create a FileReadError with category derived from file path
 *
 * Factory function that automatically determines the category (in-scope vs out-of-scope)
 * based on the file path naming convention, and extracts Node.js error codes.
 *
 * Uses function overloads to provide compile-time type narrowing:
 * - When fileExists is provided (boolean), returns FileReadErrorWithDiagnostics
 * - When fileExists is omitted, returns FileReadErrorNoDiagnostics
 *
 * This enables callers to get the specific variant type without runtime checks
 * when the factory is used correctly with known parameters.
 *
 * @param filePath - Path to the file that failed to read
 * @param error - The error that occurred
 * @param fileExists - Whether the file exists (omit for no diagnostics)
 * @param fileSize - Size of the file if it exists (for diagnostics)
 * @returns FileReadError with appropriate discriminated union variant
 */
function createFileReadError(
  filePath: string,
  error: Error,
  fileExists: boolean,
  fileSize?: number
): FileReadErrorWithDiagnostics;
function createFileReadError(filePath: string, error: Error): FileReadErrorNoDiagnostics;
function createFileReadError(
  filePath: string,
  error: Error,
  fileExists?: boolean,
  fileSize?: number
): FileReadError {
  // Validate path follows expected pattern before deriving category
  // Pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}-{random-suffix}.md
  // Random suffix prevents collisions when agents start simultaneously
  const pathPattern = /-(?:in-scope|out-of-scope)-\d+-[a-f0-9]+\.md$/;
  if (!pathPattern.test(filePath)) {
    // Log error for diagnostics before throwing
    logger.error('createFileReadError: filePath does not match expected pattern', {
      filePath,
      expectedPattern: '{agent-name}-(in-scope|out-of-scope)-{timestamp}-{random-suffix}.md',
      impact: 'Category derivation cannot proceed - this is a programming error',
      action: 'Fix agent file naming to match convention',
    });

    // Fail fast on invalid filenames instead of continuing with potentially wrong category
    // (in-scope vs out-of-scope). This prevents workflow bugs where fatal errors are treated
    // as warnings or vice versa.
    throw new ValidationError(
      buildValidationErrorMessage({
        problem: 'Invalid review result file path - cannot derive category (in-scope/out-of-scope)',
        context: `File path: ${filePath}`,
        expected: '{agent-name}-(in-scope|out-of-scope)-{timestamp}-{random-suffix}.md',
        remediation: [
          'Verify the file was created by a wiggum review agent',
          'Check agent file naming logic matches the expected convention',
          'This is a programming error - file naming convention was violated',
        ],
      })
    );
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

  // Build base fields shared by all variants
  const baseFields: FileReadErrorBase = {
    filePath,
    error,
    category,
    errorCode,
  };

  // Return appropriate discriminated union variant based on diagnostics availability
  // fileExists being defined (boolean) indicates stat() was attempted and succeeded
  if (fileExists !== undefined) {
    return {
      ...baseFields,
      diagnosticsAvailable: true,
      fileExists,
      fileSize,
    };
  }

  return {
    ...baseFields,
    diagnosticsAvailable: false,
  };
}

/**
 * Branded type for non-empty strings
 *
 * Prevents accidental mixing of validated and unvalidated strings at compile time.
 * Does NOT prevent intentional bypassing via type assertion.
 *
 * MUST use createNonEmptyString() factory to construct instances from untrusted data.
 * Use isNonEmptyString() type guard at API boundaries for defensive validation.
 * The brand serves as a marker that validation has occurred, not a runtime guarantee.
 */
type NonEmptyString = string & { readonly __brand: 'NonEmptyString' };

/**
 * Type guard for NonEmptyString validation
 *
 * Use this at API boundaries to defensively validate strings that claim to be
 * NonEmptyString but may have bypassed the factory (e.g., via type assertion).
 *
 * @param value - String value to check
 * @returns True if the string is non-empty after trimming whitespace
 *
 * @example
 * // At API boundary - defensive validation
 * function processReviewResult(result: ReviewFileReadResult) {
 *   if (!isNonEmptyString(result.content)) {
 *     throw new Error('Invalid result: content is empty');
 *   }
 *   // Now guaranteed safe to use
 * }
 */
function isNonEmptyString(value: string): value is NonEmptyString {
  return value.trim().length > 0;
}

/**
 * Create a NonEmptyString with runtime validation
 *
 * @param value - String value to validate
 * @returns NonEmptyString if validation passes
 * @throws {Error} If string is empty or whitespace-only
 */
function createNonEmptyString(value: string): NonEmptyString {
  if (!isNonEmptyString(value)) {
    throw new Error('File is empty - review agent may not have completed');
  }
  return value;
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
      // Calculate file age to help diagnose race conditions vs actual failures
      const fileAgeMs = Date.now() - stats.mtimeMs;
      const isRecentlyCreated = fileAgeMs < 5000; // Less than 5 seconds old

      // Build prioritized list of possible causes based on observable evidence
      // Most likely cause is listed first to reduce debugging time
      const prioritizedCauses: string[] = [];

      if (isRecentlyCreated) {
        // Race condition is most likely for recently created files
        prioritizedCauses.push(
          'MOST LIKELY: Race condition - File was recently created, agent may still be writing'
        );
        prioritizedCauses.push('Agent crashed or was killed during write');
      } else {
        // For older files, crash is most likely
        prioritizedCauses.push('MOST LIKELY: Agent crashed or was killed during write');
        prioritizedCauses.push('Agent found no issues and wrote empty file (check agent logs)');
      }

      // Common secondary causes
      prioritizedCauses.push('Disk space exhausted during write (check: df -h)');
      prioritizedCauses.push('Agent validation error prevented write (check agent stderr)');

      logger.error('Review file is empty - prioritized possible causes', {
        filePath,
        agentName,
        fileAgeMs,
        isRecentlyCreated,
        possibleCauses: prioritizedCauses,
        impact: 'Review results incomplete - missing agent output',
        action: isRecentlyCreated
          ? 'File was recently created - consider retry after short delay'
          : 'Check agent logs and file system for root cause',
        diagnosticCommands: {
          checkAgentLogs: `tail -n 50 /path/to/agent/${agentName}.log`,
          checkDiskSpace: 'df -h',
        },
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
    // Serious filesystem error codes that should be escalated even if stat() succeeds
    // These indicate permission/resource issues that require immediate attention
    const SERIOUS_FILESYSTEM_ERRORS = ['EACCES', 'EROFS', 'ENOSPC', 'EMFILE', 'ENFILE'];
    const originalErrorCode = (errorObj as NodeJS.ErrnoException).code;

    try {
      const stats = await stat(filePath);
      fileExists = true;
      fileSize = stats.size;

      // CRITICAL: If original error is a serious filesystem error but stat() succeeded,
      // we have an inconsistent state (file is stat-able but operation failed).
      // This indicates permission/resource issues that need escalation.
      // Example: EACCES on read but stat succeeds means we can see the file but can't read it.
      if (originalErrorCode && SERIOUS_FILESYSTEM_ERRORS.includes(originalErrorCode)) {
        logger.error('Serious filesystem error with accessible file - escalating', {
          filePath,
          category,
          errorCode: originalErrorCode,
          fileExists: true,
          fileSize: stats.size,
          impact: 'File exists and is stat-able but operation failed',
          action: 'Check file permissions, disk space, and open file limits',
        });

        const fileError = createFileReadError(filePath, errorObj, true, stats.size);
        errors.push(fileError);

        throw new FilesystemError(
          `Serious filesystem error reading review file: ${errorObj.message}\n` +
            `File exists and is stat-able (size: ${stats.size} bytes), indicating permission or resource issue.\n` +
            `Error code: ${originalErrorCode}\n\n` +
            `Actions:\n` +
            `  1. Check file permissions: ls -la "${filePath}"\n` +
            `  2. Check disk space: df -h\n` +
            `  3. Check open file limits: ulimit -n\n` +
            `  4. Verify file is not locked by another process`,
          filePath,
          errorObj,
          undefined,
          originalErrorCode
        );
      }
    } catch (statError) {
      // Re-throw FilesystemError from the serious error check above
      if (statError instanceof FilesystemError) {
        throw statError;
      }
      const statErrorObj = statError instanceof Error ? statError : new Error(String(statError));
      const statErrorCode = (statError as NodeJS.ErrnoException).code;

      // Check if this is a simple "file not found" case (both errors are ENOENT)
      // This is expected behavior, not a cascading filesystem failure
      if (originalErrorCode === 'ENOENT' && statErrorCode === 'ENOENT') {
        // File simply doesn't exist - this is expected, continue with normal error handling
        logger.debug('File does not exist (ENOENT)', {
          filePath,
          category,
        });
        // fileExists remains false, fileSize remains undefined
      } else {
        // CRITICAL: stat() failure during error recovery for non-ENOENT errors
        // indicates cascading filesystem failures. This is a serious condition:
        // both the original file operation AND the diagnostic stat() failed for
        // different reasons than "file not found".
        // Common causes: NFS mount timeout, filesystem corruption, permission cascades, disk failure.
        // We must escalate this rather than swallowing it to prevent masking filesystem issues.
        logger.error('CRITICAL: stat() failed during file read error recovery - escalating', {
          filePath,
          category,
          originalError: errorObj.message,
          originalErrorCode,
          statError: statErrorObj.message,
          statErrorCode,
          accumulatedErrorCount: errors.length,
          impact: 'Cascading filesystem failure detected - cannot diagnose original error',
          action:
            'Check file system health with fsck, verify NFS mount status, check file permissions recursively',
          escalation: 'Throwing FilesystemError to surface this critical issue',
        });

        // Add error to errors array BEFORE throwing so diagnostic information is preserved
        // This allows callers to see the full context of failures even when we escalate
        const cascadeFileError = createFileReadError(filePath, errorObj, false, undefined);
        errors.push(cascadeFileError);

        // Escalate cascading filesystem failures instead of silently continuing
        throw new FilesystemError(
          `Cascading filesystem failure while reading review file.\n` +
            `Original error: ${errorObj.message}\n` +
            `Diagnostic stat() also failed: ${statErrorObj.message}\n\n` +
            `This indicates a serious filesystem issue (NFS timeout, corruption, permission cascade).\n` +
            `Actions:\n` +
            `  1. Check file system health: fsck or equivalent\n` +
            `  2. Verify NFS mount status if applicable: mount | grep nfs\n` +
            `  3. Check permissions recursively: ls -la $(dirname "${filePath}")\n` +
            `  4. Check disk space: df -h`,
          filePath,
          errorObj,
          statErrorObj,
          statErrorCode
        );
      }
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
 * Load review results from scope-separated file path lists
 *
 * Reads multiple review result files and aggregates them with agent headers.
 * Collects errors from all file reads and provides comprehensive error context
 * if any files fail to read. Includes error codes and file metadata for diagnostics.
 *
 * In-scope file path failures are fatal (throw ValidationError).
 * Out-of-scope file path failures are non-fatal but return warnings to inform users.
 *
 * @param inScopeFilePaths - Array of paths to in-scope review result files
 * @param outOfScopeFilePaths - Array of paths to out-of-scope review result files
 * @returns Object with formatted in-scope/out-of-scope sections and any warnings
 * @throws {ValidationError} If in-scope file paths fail to read, with details of all failures
 *
 * @example
 * // Load results from multiple agent result file paths
 * const { inScope, outOfScope, warnings } = await loadReviewResults(
 *   ['/tmp/claude/wiggum-625/code-reviewer-in-scope-1234567890-abc123.md'],
 *   ['/tmp/claude/wiggum-625/code-reviewer-out-of-scope-1234567890-def456.md']
 * );
 * if (warnings.length > 0) {
 *   console.warn('Review data incomplete:', warnings.join('\n'));
 * }
 */
export async function loadReviewResults(
  inScopeFilePaths: readonly string[] = [],
  outOfScopeFilePaths: readonly string[] = []
): Promise<LoadReviewResultsOutput> {
  const errors: FileReadError[] = [];

  // Read all in-scope file paths
  const inScopeResults: string[] = [];
  for (const filePath of inScopeFilePaths) {
    const result = await readReviewFile(filePath, 'in-scope', errors);
    if (result) {
      inScopeResults.push(`#### ${result.agentName}\n\n${result.content}\n\n---\n`);
    }
  }

  // Read all out-of-scope file paths
  const outOfScopeResults: string[] = [];
  for (const filePath of outOfScopeFilePaths) {
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
        .map((e) => {
          const { filePath, error, category, errorCode } = e;
          const code = errorCode ? ` [${errorCode}]` : '';
          const existence = e.diagnosticsAvailable
            ? ` (exists: ${e.fileExists}, size: ${e.fileSize ?? 'unknown'})`
            : '';
          return `  - [${category}] ${filePath}${code}: ${error.message}${existence}`;
        })
        .join('\n');

      // Collect failed file paths for set operations
      const failedPaths = new Set(inScopeErrors.map((e) => e.filePath));
      const successfulInScope = inScopeFilePaths.filter((f) => !failedPaths.has(f));

      // Classify errors to help user decide action
      const hasPermissionErrors = inScopeErrors.some((e) => e.errorCode === 'EACCES');
      const hasMissingFiles = inScopeErrors.some((e) => e.errorCode === 'ENOENT');
      // Use discriminated union to safely check for empty files
      const hasEmptyFiles = inScopeErrors.some(
        (e) => e.diagnosticsAvailable && e.fileExists && e.fileSize === 0
      );

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
        totalInScopeFilePaths: inScopeFilePaths.length,
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
      const totalOutOfScope = outOfScopeFilePaths.length;

      // Check if ALL out-of-scope files failed (indicates systemic issue)
      const allFailed = outOfScopeErrors.length === totalOutOfScope && totalOutOfScope > 0;

      if (allFailed) {
        // Systemic failure - escalate to error level logging but still allow workflow to proceed
        // since out-of-scope is not blocking
        logger.error('ALL out-of-scope files failed to load - systemic issue detected', {
          totalFiles: totalOutOfScope,
          failedFiles: outOfScopeErrors.map((e) => ({
            path: e.filePath,
            code: e.errorCode,
            reason: e.error.message,
          })),
          impact: 'ALL out-of-scope recommendations lost - likely systemic issue',
          possibleCauses: [
            'File permissions issue affecting all files',
            'Disk/NFS mount failure',
            'Agent output directory not created',
            'All agents crashed before writing output',
          ],
          action: 'Check filesystem health and agent logs',
        });
      }

      // Calculate data loss percentage for user warning
      const dataLossPercentage =
        totalOutOfScope > 0
          ? ((outOfScopeErrors.length / totalOutOfScope) * 100).toFixed(0)
          : '100';

      const warningMsg = allFailed
        ? `**CRITICAL WARNING**: ALL ${totalOutOfScope} out-of-scope review file(s) failed to load. ` +
          `Out-of-scope recommendations are COMPLETELY UNAVAILABLE. ` +
          `This indicates a systemic issue (permissions, disk, NFS). ` +
          `Failed files: ${failedFileNames}`
        : `Warning: ${outOfScopeErrors.length} of ${totalOutOfScope} out-of-scope review file(s) failed to load ` +
          `(${dataLossPercentage}% data loss). ` +
          `Out-of-scope recommendations may be incomplete. ` +
          `Failed files: ${failedFileNames}`;

      warnings.push(warningMsg);

      if (!allFailed) {
        logger.warn(
          'Out-of-scope review files failed to load - proceeding with degraded tracking',
          {
            outOfScopeErrorCount: outOfScopeErrors.length,
            totalOutOfScopeFilePaths: outOfScopeFilePaths.length,
            successfulOutOfScope: outOfScopeResults.length,
            dataLossPercentage: `${dataLossPercentage}%`,
            impact: 'Out-of-scope recommendations may be incomplete',
            failedFiles: outOfScopeErrors.map((e) => ({
              path: e.filePath,
              code: e.errorCode,
              reason: e.error.message,
            })),
          }
        );
      }
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
    phase1Step: z.string().min(1, 'phase1Step cannot be empty'),
    phase2Step: z.string().min(1, 'phase2Step cannot be empty'),
    phase1Command: z.string().min(1, 'phase1Command cannot be empty'),
    phase2Command: z.string().min(1, 'phase2Command cannot be empty'),
    reviewTypeLabel: z.string().min(1, 'reviewTypeLabel cannot be empty'),
    issueTypeLabel: z.string().min(1, 'issueTypeLabel cannot be empty'),
    successMessage: z.string().min(1, 'successMessage cannot be empty'),
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
 * Create a validated PR review configuration
 *
 * Factory function that creates a ReviewConfig for PR reviews with
 * all required fields pre-configured and validated. This reduces
 * duplication and ensures consistency across PR review tools.
 *
 * @returns Validated ReviewConfig for PR reviews
 */
export function createPRReviewConfig(): ReviewConfig {
  return validateReviewConfig({
    phase1Step: STEP_PHASE1_PR_REVIEW,
    phase2Step: STEP_PHASE2_PR_REVIEW,
    phase1Command: PHASE1_PR_REVIEW_COMMAND,
    phase2Command: PHASE2_PR_REVIEW_COMMAND,
    reviewTypeLabel: 'PR',
    issueTypeLabel: 'issue(s)',
    successMessage: `No PR review issues found. The code meets quality standards.

**Aspects Covered:**
- Code quality and maintainability
- Type safety and error handling
- Test coverage and assertions
- Documentation completeness`,
  });
}

/**
 * Create a validated Security review configuration
 *
 * Factory function that creates a ReviewConfig for security reviews with
 * all required fields pre-configured and validated. This reduces
 * duplication and ensures consistency across security review tools.
 *
 * @returns Validated ReviewConfig for security reviews
 */
export function createSecurityReviewConfig(): ReviewConfig {
  return validateReviewConfig({
    phase1Step: STEP_PHASE1_SECURITY_REVIEW,
    phase2Step: STEP_PHASE2_SECURITY_REVIEW,
    phase1Command: SECURITY_REVIEW_COMMAND,
    phase2Command: SECURITY_REVIEW_COMMAND,
    reviewTypeLabel: 'Security',
    issueTypeLabel: 'security issue(s) found',
    successMessage: `All security checks passed with no vulnerabilities identified.

**Security Aspects Covered:**
- Authentication and authorization
- Input validation and sanitization
- Secrets management
- Dependency vulnerabilities
- Security best practices`,
  });
}

/**
 * Zod schema for ReviewCompletionInput runtime validation
 *
 * **Field naming convention:**
 * - `*_result_files` are file paths containing review results (each file may have multiple issues)
 * - `*_issue_count` are the total number of issues (not files)
 *
 * This naming makes the semantic relationship clear: result files contain issues,
 * and counts reflect issue totals, not file counts.
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
    in_scope_result_files: z.array(z.string().min(1, 'File path cannot be empty')),
    out_of_scope_result_files: z.array(z.string().min(1, 'File path cannot be empty')),
    in_scope_issue_count: z
      .number()
      .int()
      .nonnegative()
      .refine(Number.isFinite, {
        message: 'in_scope_issue_count must be finite (not Infinity or NaN)',
      })
      .refine(Number.isSafeInteger, {
        message: 'in_scope_issue_count must be a safe integer (within MAX_SAFE_INTEGER)',
      }),
    out_of_scope_issue_count: z
      .number()
      .int()
      .nonnegative()
      .refine(Number.isFinite, {
        message: 'out_of_scope_issue_count must be finite (not Infinity or NaN)',
      })
      .refine(Number.isSafeInteger, {
        message: 'out_of_scope_issue_count must be a safe integer (within MAX_SAFE_INTEGER)',
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
      // If in_scope_issue_count > 0, we must have at least one result file
      return data.in_scope_issue_count === 0 || data.in_scope_result_files.length > 0;
    },
    {
      message:
        'in_scope_issue_count is greater than 0 but in_scope_result_files is empty. ' +
        'If there are in-scope issues, file paths must be provided.',
    }
  )
  .refine(
    (data) => {
      // If out_of_scope_issue_count > 0, we must have at least one result file
      return data.out_of_scope_issue_count === 0 || data.out_of_scope_result_files.length > 0;
    },
    {
      message:
        'out_of_scope_issue_count is greater than 0 but out_of_scope_result_files is empty. ' +
        'If there are out-of-scope issues, file paths must be provided.',
    }
  );

/**
 * Input for review completion
 *
 * **Field naming convention:**
 * - `*_result_files` are file paths containing review results (each file may have multiple issues)
 * - `*_issue_count` are the total number of issues (not files)
 *
 * TODO(#637): Consider factory function to enforce "at least one verbatim field" invariant at type level
 *
 * @see ReviewCompletionInputSchema for complete validation rules
 */
export interface ReviewCompletionInput {
  /** Must be true - enforced by schema to prevent skipping review */
  readonly command_executed: true;
  /** File paths containing in-scope review results (each file may contain multiple issues) */
  readonly in_scope_result_files: readonly string[];
  /** File paths containing out-of-scope review results (each file may contain multiple issues) */
  readonly out_of_scope_result_files: readonly string[];
  /** Total count of in-scope issues across all result files */
  readonly in_scope_issue_count: number;
  /** Total count of out-of-scope issues across all result files */
  readonly out_of_scope_issue_count: number;
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

// TODO(#637): Add readonly modifiers and factory function with validation for non-negative integers
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
    return createWiggumState({
      iteration: currentState.wiggum.iteration + 1,
      step: reviewStep,
      completedSteps: currentState.wiggum.completedSteps,
      phase: currentState.wiggum.phase,
      maxIterations: maxIterations ?? currentState.wiggum.maxIterations,
    });
  }

  // If no in-scope issues (even if out-of-scope exist), mark complete and advance to next step
  // Use advanceToNextStep() to maintain invariant: completedSteps contains only steps before current
  const baseState = advanceToNextStep(currentState.wiggum);
  return createWiggumState({
    ...baseState,
    maxIterations: maxIterations ?? currentState.wiggum.maxIterations,
  });
}

/**
 * Sleep helper for retry delays
 *
 * Exported for testing - allows tests to provide a mock that records delays
 * without actually waiting, enabling fast tests of exponential backoff logic.
 */
export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dependencies for safePostReviewComment (for testing)
 */
export interface SafePostReviewCommentDeps {
  /** Function to post a comment to an issue */
  postIssueComment: (issueNumber: number, body: string) => Promise<void>;
  /** Function to sleep for retry delays */
  sleep: (ms: number) => Promise<void>;
}

/**
 * Post review comment to GitHub issue with retry logic for transient failures
 *
 * This function posts detailed review results as a comment to the linked GitHub issue.
 * It's non-blocking: failures don't halt the workflow since state is already persisted
 * in the PR/issue body.
 *
 * Error handling strategy:
 * - Critical errors (404, 401/403): Log error, return false, continue workflow (no retry)
 * - Transient errors (429, network): Retry with exponential backoff (2s, 4s, 8s)
 * - Unexpected errors: Log error, return false, continue workflow (no retry)
 *
 * @param issueNumber - GitHub issue number to post comment to
 * @param commentTitle - Title/heading for the comment
 * @param commentBody - Full comment body with review details
 * @param reviewStep - Current review step for logging context
 * @param maxRetries - Maximum retry attempts (default: 3, range: 1-100)
 * @param deps - Optional dependencies for testing (defaults to real implementations)
 * @returns Promise<boolean> - true if comment posted successfully, false if failed
 * @throws {ValidationError} If maxRetries is not a positive integer in range 1-100
 */
export async function safePostReviewComment(
  issueNumber: number,
  commentTitle: string,
  commentBody: string,
  reviewStep: WiggumStep,
  maxRetries = 3,
  deps?: Partial<SafePostReviewCommentDeps>
): Promise<boolean> {
  // CRITICAL: Invalid maxRetries would break retry logic:
  //   - maxRetries < 1: Loop would not execute (no retries attempted)
  //   - maxRetries > 100: Excessive delays (up to 100 minutes with 60s cap)
  //   - Non-integer: Unpredictable loop behavior
  // Throw ValidationError (programming error) rather than returning false (operational failure)
  const MAX_RETRIES_LIMIT = 100;
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > MAX_RETRIES_LIMIT) {
    logger.error('safePostReviewComment: Invalid maxRetries parameter - throwing ValidationError', {
      issueNumber,
      reviewStep,
      maxRetries,
      maxRetriesType: typeof maxRetries,
      impact: 'Programming error - caller passed invalid maxRetries',
      action: 'Fix caller to pass valid maxRetries value (1-100, default: 3)',
      validRange: `1-${MAX_RETRIES_LIMIT}`,
    });
    throw new ValidationError(
      `safePostReviewComment: maxRetries must be a positive integer (1-${MAX_RETRIES_LIMIT}), ` +
        `got: ${maxRetries} (type: ${typeof maxRetries}). ` +
        `This is a programming error - fix the caller to pass valid maxRetries.`
    );
  }

  // Use injected dependencies or import real implementations
  const postComment =
    deps?.postIssueComment ?? (await import('../state/issue-comments.js')).postIssueComment;
  const sleep = deps?.sleep ?? sleepMs;

  const fullCommentBody = `## ${commentTitle}\n\n${commentBody}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await postComment(issueNumber, fullCommentBody);

      // Log success (or recovery on retry)
      if (attempt > 1) {
        logger.info('Posted review comment to issue after retry', {
          issueNumber,
          reviewStep,
          attempt,
          maxRetries,
          impact: 'Transient failure recovered automatically',
        });
      } else {
        logger.info('Posted review comment to issue', {
          issueNumber,
          reviewStep,
          commentLength: fullCommentBody.length,
        });
      }

      return true;
    } catch (commentError) {
      // Comment posting is NON-BLOCKING - state already persisted in body
      // Classify errors to distinguish transient (rate limit, network) from critical (404, auth)
      const errorMsg = commentError instanceof Error ? commentError.message : String(commentError);
      const exitCode = commentError instanceof GitHubCliError ? commentError.exitCode : undefined;
      const stderr = commentError instanceof GitHubCliError ? commentError.stderr : undefined;

      // Build error context for logging
      const errorContext = {
        issueNumber,
        reviewStep,
        attempt,
        maxRetries,
        error: errorMsg,
        errorType: commentError instanceof GitHubCliError ? 'GitHubCliError' : typeof commentError,
        exitCode,
        stderr,
      };

      // Classify error type based on error message patterns and exit codes
      const is404 = /not found|404/i.test(errorMsg) || exitCode === 404;
      const isAuth =
        /permission|forbidden|unauthorized|401|403/i.test(errorMsg) ||
        exitCode === 401 ||
        exitCode === 403;
      const isRateLimit = /rate limit|429/i.test(errorMsg) || exitCode === 429;
      const isNetwork = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|fetch/i.test(errorMsg);

      // Critical errors: Issue not found or authentication failures - log and return false (no retry)
      if (is404) {
        logger.error('Cannot post review comment - issue not found', {
          ...errorContext,
          impact: 'Review results not visible in issue, but state persisted in body',
          recommendation: `Verify issue #${issueNumber} exists: gh issue view ${issueNumber}`,
          isTransient: false,
        });
        return false;
      }

      if (isAuth) {
        logger.error('Cannot post review comment - authentication failed', {
          ...errorContext,
          impact: 'Review results not visible in issue, but state persisted in body',
          recommendation: 'Check gh auth status and token scopes: gh auth status',
          isTransient: false,
        });
        return false;
      }

      // Transient errors: Rate limits or network issues - retry with backoff
      if (isRateLimit || isNetwork) {
        const reason = isRateLimit ? 'rate_limit' : 'network';

        if (attempt < maxRetries) {
          // Exponential backoff: 2^attempt seconds, capped at 60s
          const MAX_DELAY_MS = 60000;
          const uncappedDelayMs = Math.pow(2, attempt) * 1000;
          const delayMs = Math.min(uncappedDelayMs, MAX_DELAY_MS);
          logger.info('Transient error posting review comment - retrying with backoff', {
            ...errorContext,
            reason,
            delayMs,
            wasCapped: uncappedDelayMs > MAX_DELAY_MS,
            remainingAttempts: maxRetries - attempt,
          });
          await sleep(delayMs);
          continue; // Retry
        }

        // All retries exhausted - log warning and return false
        logger.warn('Failed to post review comment after all retries', {
          ...errorContext,
          reason,
          impact: 'Review results not visible in issue, but state persisted in body',
          recommendation:
            reason === 'rate_limit'
              ? 'Check rate limit status: gh api rate_limit'
              : 'Check network connection and GitHub API status',
          isTransient: true,
        });
        return false;
      }

      // Unexpected errors: Programming errors or unknown failures - log and return false (no retry)
      logger.error('Unexpected error posting review comment', {
        ...errorContext,
        impact: 'Review results not visible in issue, but state persisted in body',
        recommendation: 'Check error details and consider manual comment posting',
        isTransient: false,
      });
      return false;
    }
  }

  // TODO(#992): Consider simplifying verbose unreachable code error handling - move detailed
  // comments to design doc, keep only essential error message

  // UNREACHABLE: Loop must execute at least once (maxRetries validated), and every iteration
  // either returns success, returns failure, or continues. Reaching here indicates:
  // 1. Validation bug: maxRetries <= 0 was allowed
  // 2. Loop bug: An iteration path neither returned nor continued
  //
  // If this error occurs, check:
  // - Error logs for actual maxRetries value and iteration count
  // - Review all loop code paths for missing return/continue statements
  // - Verify maxRetries validation is enforced at all entry points
  logger.error('CRITICAL: Unreachable code path in safePostReviewComment', {
    issueNumber,
    reviewStep,
    maxRetries,
    impact: 'Internal error - retry loop logic violation',
  });
  return false;
}

/**
 * New state shape for retryStateUpdate
 */
export interface RetryStateUpdateNewState {
  iteration: number;
  step: WiggumStep;
  completedSteps: readonly WiggumStep[];
  phase: WiggumPhase;
}

/**
 * Dependencies for retryStateUpdate (for testing)
 */
export interface RetryStateUpdateDeps {
  /** Function to update body state */
  updateBodyState: (
    state: CurrentState,
    newState: RetryStateUpdateNewState
  ) => Promise<StateUpdateResult>;
  /** Function to sleep for retry delays */
  sleep: (ms: number) => Promise<void>;
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
 * @param deps - Optional dependencies for testing (defaults to real implementations)
 * @returns StateUpdateResult after retries exhausted or success
 * @throws {ValidationError} If maxRetries is not a positive integer
 */
export async function retryStateUpdate(
  state: CurrentState,
  newState: RetryStateUpdateNewState,
  maxRetries = 3,
  deps?: Partial<RetryStateUpdateDeps>
): Promise<StateUpdateResult> {
  // CRITICAL: Invalid maxRetries would break retry logic:
  //   - maxRetries < 1: Loop would not execute (no retries attempted)
  //   - Non-integer: Unpredictable loop behavior
  // Throw ValidationError (programming error) since StateUpdateResult only supports operational failures
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    logger.error('retryStateUpdate: Invalid maxRetries parameter - throwing ValidationError', {
      maxRetries,
      maxRetriesType: typeof maxRetries,
      phase: state.wiggum.phase,
      step: newState.step,
      prNumber: state.pr.exists ? state.pr.number : undefined,
      issueNumber: state.issue.exists ? state.issue.number : undefined,
      impact: 'State update will fail - this is a programming error',
      action: 'Fix caller to pass valid maxRetries value (positive integer, default: 3)',
    });
    throw new ValidationError(
      `retryStateUpdate: maxRetries must be a positive integer, got: ${maxRetries} (type: ${typeof maxRetries}). ` +
        `This is a programming error - fix the caller to pass valid maxRetries.`
    );
  }

  // Use injected dependencies or default to real implementations
  const doUpdateBodyState = deps?.updateBodyState ?? updateBodyState;
  const sleep = deps?.sleep ?? sleepMs;

  // DO NOT initialize result here - force every code path to set it
  // This prevents returning a misleading placeholder error that says "network failure"
  // when no network call was actually attempted.
  let result: StateUpdateResult | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    result = await doUpdateBodyState(state, newState);

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

    // All failures are transient (rate_limit or network), so retry until maxRetries
    if (attempt === maxRetries) {
      logger.warn('State update failed - max retries reached', {
        attempt,
        maxRetries,
        reason: result.reason,
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
    await sleep(delayMs);
  }

  // TODO(#992): Consider simplifying verbose unreachable code error handling - move detailed
  // comments to design doc, keep only essential error message

  // UNREACHABLE: Loop must execute at least once (maxRetries >= 1 validated above), and every
  // iteration either returns success, returns failure, or continues. Reaching here indicates:
  // 1. Validation bug: maxRetries check was bypassed or incorrect
  // 2. Loop bug: An iteration path neither returned nor continued
  // 3. TypeScript inference bug: Control flow analysis is incorrect
  //
  // If this error occurs, check:
  // - Error logs for actual maxRetries value and iteration count
  // - Review all loop code paths for missing return/continue statements
  // - Verify TypeScript version didn't regress on control flow analysis
  // - Check if any async/await errors could skip loop body
  //
  // Consolidated error handling provides consistent diagnostics regardless of whether result was set

  // Build common diagnostic context for error handling
  const diagnosticContext = {
    maxRetries,
    phase: state.wiggum.phase,
    step: newState.step,
    resultDefined: result !== undefined,
    lastResult: result !== undefined ? JSON.stringify(result) : 'undefined',
  };

  logger.error('CRITICAL: retryStateUpdate unreachable code path reached', diagnosticContext);

  // Defensive: Verify result was set before using it in error message
  // This prevents a secondary error from JSON.stringify(undefined)
  if (result === undefined) {
    throw new Error(
      `INTERNAL ERROR: retryStateUpdate loop completed without setting result variable. ` +
        `This indicates a severe programming error: loop should execute at least once (maxRetries=${maxRetries}) ` +
        `but result was never assigned. phase=${state.wiggum.phase}, step=${newState.step}`
    );
  }

  throw new Error(
    `INTERNAL ERROR: retryStateUpdate loop completed without returning. ` +
      `This indicates a programming error: loop iteration neither returned nor continued. ` +
      `maxRetries=${maxRetries}, phase=${state.wiggum.phase}, step=${newState.step}, ` +
      `lastResult=${JSON.stringify(result)}`
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
  outOfScopeFiles?: readonly string[],
  dataCompletenessWarning?: string
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
  const baseInstructions = generateScopeSeparatedFixInstructions(
    issueNumber,
    reviewTypeForTriage,
    inScopeCount,
    inScopeFiles!,
    outOfScopeCount,
    outOfScopeFiles ?? []
  );

  // Prepend data completeness warning if present (surfaces file loading issues to user)
  const instructions = dataCompletenessWarning
    ? `${dataCompletenessWarning}${baseInstructions}`
    : baseInstructions;

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
      in_scope_issue_count: inScopeCount,
      out_of_scope_issue_count: outOfScopeCount,
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
  const {
    inScope,
    outOfScope,
    warnings: loadWarnings,
  } = await loadReviewResults(input.in_scope_result_files, input.out_of_scope_result_files);

  // Combine formatted sections for comment
  const verbatimResponse = [inScope, outOfScope].filter(Boolean).join('\n\n');

  // Log any warnings from file loading - these indicate potentially incomplete review data
  // (e.g., out-of-scope files that failed to load, empty files, etc.)
  // IMPORTANT: Surface these warnings in the response so users know data may be incomplete
  let dataCompletenessWarning: string | undefined;
  if (loadWarnings.length > 0) {
    logger.warn('Review result loading completed with warnings', {
      warningCount: loadWarnings.length,
      warnings: loadWarnings,
      reviewType: config.reviewTypeLabel,
      impact: 'Some review data may be incomplete - check warnings for details',
    });
    // Build user-facing warning to prepend to instructions
    dataCompletenessWarning =
      `**Data Completeness Warning:**\n${loadWarnings.join('\n')}\n\n` +
      `Review data may be incomplete. Some out-of-scope recommendations may not have been loaded.\n\n---\n\n`;
  }

  const state = await detectCurrentState();
  const reviewStep = getReviewStep(state.wiggum.phase, config);

  validatePhaseRequirements(state, config);

  // NOTE: Zod schema (ReviewCompletionInputSchema) already validates that in_scope_issue_count
  // and out_of_scope_issue_count are non-negative safe integers. No additional validation needed.
  const inScopeCount = input.in_scope_issue_count;
  const outOfScopeCount = input.out_of_scope_issue_count;

  // NOTE: in_scope_issue_count and out_of_scope_issue_count represent the number of ISSUES,
  // not the number of result files. Each file can contain multiple issues from one agent.
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

  // Post review comment to issue (non-blocking)
  // State update succeeded, now post detailed review results as a comment to the linked issue
  // Track posting status to surface to user if it fails
  let commentPostingFailureNote = '';

  if (state.issue.exists && state.issue.number) {
    const issueNumber = state.issue.number;

    // Build comment using existing buildCommentContent function
    const { title, body } = buildCommentContent(
      verbatimResponse,
      reviewStep,
      issues,
      config,
      state.wiggum.phase
    );

    // Post comment with retry logic (non-blocking)
    const commentPosted = await safePostReviewComment(issueNumber, title, body, reviewStep);

    if (!commentPosted) {
      logger.warn('Review comment not posted - workflow continuing normally', {
        issueNumber,
        reviewStep,
        reviewType: config.reviewTypeLabel,
        phase: state.wiggum.phase,
        impact: 'Review results not visible in issue, but state persisted in body',
      });

      // Build user-facing note about comment posting failure
      // This ensures users know to check the issue/PR body for state rather than comments
      commentPostingFailureNote =
        `\n\n**Note: Comment Posting Failed**\n` +
        `Review results could not be posted as a comment to issue #${issueNumber}. ` +
        `This is a non-fatal error - the workflow state has been persisted successfully in the ` +
        `${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} body. ` +
        `Check the ${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} body for current state, not comments.\n`;
    }
  } else {
    // UNREACHABLE: validatePhaseRequirements ensures issue exists before reaching this point.
    // Reaching here indicates:
    // 1. validatePhaseRequirements was bypassed or its check was modified
    // 2. State was mutated between validation and this check
    //
    // If this error occurs, check:
    // - That validatePhaseRequirements is called before this code path
    // - That state.issue is not reassigned after validation
    // - That the caller didn't skip validation
    logger.error('Missing issue for comment posting - skipping comment', {
      phase: state.wiggum.phase,
      reviewStep,
      issueExists: state.issue.exists,
      issueNumber: state.issue.exists ? state.issue.number : undefined,
      action: 'Continuing workflow without comment',
    });
  }

  // Combine all warnings for response (data completeness + comment posting failure)
  const combinedWarning = dataCompletenessWarning
    ? `${dataCompletenessWarning}${commentPostingFailureNote}`
    : commentPostingFailureNote || undefined;

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
      input.in_scope_result_files,
      input.out_of_scope_result_files,
      combinedWarning
    );
  }

  // No in-scope issues: step is complete, but check for out-of-scope recommendations
  const hasOutOfScopeIssues = outOfScopeCount > 0;

  if (hasOutOfScopeIssues) {
    // Step is marked complete (newState already posted), but we need to track out-of-scope issues
    const issueNumber = state.issue.exists ? state.issue.number : undefined;
    const outOfScopeFiles = input.out_of_scope_result_files ?? [];

    // Reuse the newState we just posted to avoid race condition with GitHub API (issue #388)
    const updatedState = applyWiggumState(state, newState);

    // Return instructions to track out-of-scope issues, then proceed to next step
    const baseOutOfScopeInstructions = generateOutOfScopeTrackingInstructions(
      issueNumber,
      config.reviewTypeLabel,
      outOfScopeCount,
      outOfScopeFiles
    );

    // Prepend combined warning if present (surfaces file loading issues + comment posting failures to user)
    const outOfScopeInstructions = combinedWarning
      ? `${combinedWarning}${baseOutOfScopeInstructions}`
      : baseOutOfScopeInstructions;

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
