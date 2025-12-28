/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError } from './errors.js';
import { getGitRoot } from './git.js';
import { logger } from './logger.js';

export interface GhCliOptions {
  repo?: string;
  timeout?: number;
  cwd?: string;
}

/**
 * Execute a GitHub CLI command safely with proper error handling
 *
 * Runs gh CLI commands with automatic working directory resolution,
 * optional repository specification, timeout support, and comprehensive
 * error handling. Includes command context in error messages for easier debugging.
 *
 * @param args - GitHub CLI command arguments (e.g., ['pr', 'view', '123'])
 * @param options - Optional execution options (repo, cwd, timeout)
 * @returns The stdout from the gh command
 * @throws {GitHubCliError} When gh command fails or exits with non-zero code
 *
 * @example
 * ```typescript
 * const prData = await ghCli(['pr', 'view', '123', '--json', 'title']);
 * const repo = await ghCli(['repo', 'view', '--json', 'nameWithOwner']);
 * ```
 */
export async function ghCli(args: string[], options: GhCliOptions = {}): Promise<string> {
  try {
    const cwd = options.cwd || (await getGitRoot());
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
      cwd: cwd,
    };

    // Add repo flag if provided
    const fullArgs = options.repo ? ['--repo', options.repo, ...args] : args;

    const result = await execa('gh', fullArgs, execaOptions);

    if (result.exitCode !== 0) {
      throw new GitHubCliError(
        `GitHub CLI command failed (gh ${fullArgs.join(' ')}): ${result.stderr || result.stdout}`,
        result.exitCode,
        result.stderr || undefined
      );
    }

    return result.stdout || '';
  } catch (error) {
    // TODO: See issue #443 - Distinguish programming errors from operational errors
    if (error instanceof GitHubCliError) {
      throw error;
    }
    // Preserve original error type for better debugging, but wrap in GitHubCliError
    const originalError = error instanceof Error ? error : new Error(String(error));
    throw new GitHubCliError(
      `Failed to execute gh CLI command (gh ${args.join(' ')}): ${originalError.message}`,
      undefined,
      undefined,
      undefined,
      originalError
    );
  }
}

/**
 * Execute a GitHub CLI command and parse JSON output
 *
 * Convenience wrapper around ghCli that automatically parses JSON responses.
 *
 * @param args - GitHub CLI command arguments
 * @param options - Optional execution options
 * @returns Parsed JSON response
 * @throws {GitHubCliError} When gh command fails or JSON parsing fails
 *
 * @example
 * ```typescript
 * interface PR { number: number; title: string; }
 * const pr = await ghCliJson<PR>(['pr', 'view', '--json', 'number,title']);
 * ```
 */
export async function ghCliJson<T>(args: string[], options: GhCliOptions = {}): Promise<T> {
  const output = await ghCli(args, options);

  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new GitHubCliError(
      `Failed to parse JSON response from gh CLI: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get the current repository in format "owner/repo"
 *
 * Queries GitHub CLI for the current repository. Must be run from
 * within a git repository directory. Includes original error details
 * in error messages for better debugging.
 *
 * @returns Repository in "owner/repo" format (e.g., "github/gh")
 * @throws {GitHubCliError} When not in a repository or gh command fails
 *
 * @example
 * ```typescript
 * const repo = await getCurrentRepo();
 * console.log(repo); // "owner/repo-name"
 * ```
 */
export async function getCurrentRepo(): Promise<string> {
  try {
    const result = await ghCli(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    return result.trim();
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    throw new GitHubCliError(
      `Failed to get current repository. Make sure you're in a git repository or provide the --repo flag. Original error: ${originalMessage}`,
      error instanceof GitHubCliError ? error.exitCode : undefined,
      error instanceof GitHubCliError ? error.stderr : undefined,
      undefined,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Resolve repository - use provided repo or get current repo
 *
 * Helper function that returns the provided repository or automatically
 * detects the current repository if none is provided.
 *
 * @param repo - Optional repository in "owner/repo" format
 * @returns Resolved repository in "owner/repo" format
 * @throws {GitHubCliError} When repo is not provided and current repo detection fails
 *
 * @example
 * ```typescript
 * const repo = await resolveRepo("owner/repo"); // Returns "owner/repo"
 * const currentRepo = await resolveRepo(); // Auto-detects from git directory
 * ```
 */
export async function resolveRepo(repo?: string): Promise<string> {
  if (repo) {
    return repo;
  }
  return getCurrentRepo();
}

/**
 * GitHub PR response type from gh pr view --json
 */
export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  mergeable: string;
  mergeStateStatus: string;
  labels?: Array<{ name: string }>;
}

/**
 * Get PR details
 *
 * Fetches pull request information from GitHub using gh CLI.
 * If prNumber is omitted or undefined, gets PR for current branch.
 *
 * @param prNumber - Optional PR number to fetch. If omitted, fetches PR for current branch.
 * @param repo - Optional repository in "owner/repo" format
 * @returns PR details including number, title, labels, head/base refs, etc.
 * @throws {GitHubCliError} When PR doesn't exist or gh command fails
 *
 * @example
 * ```typescript
 * const pr = await getPR(123, "owner/repo");
 * const currentBranchPR = await getPR(); // Gets PR for current branch
 * ```
 */
export async function getPR(prNumber?: number, repo?: string): Promise<GitHubPR> {
  const args = [
    'pr',
    'view',
    ...(prNumber ? [prNumber.toString()] : []), // Omit number to get current branch PR
    '--json',
    'number,title,state,url,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,labels',
  ];

  // Only use --repo flag when we have a PR number
  // gh pr view without args (current branch) doesn't work with --repo flag
  const options = prNumber && repo ? { repo: await resolveRepo(repo) } : {};

  return ghCliJson<GitHubPR>(args, options);
}

/**
 * GitHub PR comment type
 */
export interface GitHubPRComment {
  author: string;
  body: string;
  createdAt: string;
  id: string;
}

/**
 * Get all comments for a PR
 *
 * Fetches all comments on a pull request using gh CLI.
 * Returns simplified comment objects with author, body, timestamp, and ID.
 *
 * @param prNumber - PR number to fetch comments for
 * @param repo - Optional repository in "owner/repo" format
 * @returns Array of PR comments with author, body, createdAt, and id
 * @throws {GitHubCliError} When PR doesn't exist or gh command fails
 *
 * @example
 * ```typescript
 * const comments = await getPRComments(123, "owner/repo");
 * for (const comment of comments) {
 *   console.log(`${comment.author}: ${comment.body}`);
 * }
 * ```
 */
export async function getPRComments(prNumber: number, repo?: string): Promise<GitHubPRComment[]> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson<GitHubPRComment[]>(
    [
      'pr',
      'view',
      prNumber.toString(),
      '--json',
      'comments',
      '-q',
      '.comments | map({author: .author.login, body: .body, createdAt: .createdAt, id: .id})',
    ],
    { repo: resolvedRepo }
  );
}

/**
 * Post a comment to a PR
 *
 * Posts a new comment on a pull request using gh CLI.
 *
 * @param prNumber - PR number to comment on
 * @param body - Comment body (markdown supported)
 * @param repo - Optional repository in "owner/repo" format
 * @throws {GitHubCliError} When PR doesn't exist or gh command fails
 *
 * @example
 * ```typescript
 * await postPRComment(123, "LGTM! Approved.", "owner/repo");
 * ```
 */
export async function postPRComment(prNumber: number, body: string, repo?: string): Promise<void> {
  const resolvedRepo = await resolveRepo(repo);
  await ghCli(['pr', 'comment', prNumber.toString(), '--body', body], { repo: resolvedRepo });
}

/**
 * GitHub PR review comment type (from API)
 * Note: This is a subset of the full API response - includes common fields
 */
export interface GitHubPRReviewComment {
  readonly id: number;
  readonly user: {
    readonly login: string;
  };
  readonly body: string;
  readonly path: string;
  readonly position?: number;
  readonly line?: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly [key: string]: unknown; // Allow additional fields from GitHub API
}

/**
 * Result from getPRReviewComments including parsed comments and skip count
 */
export interface PRReviewCommentsResult {
  /** Successfully parsed review comments */
  readonly comments: readonly GitHubPRReviewComment[];
  /** Number of comments that failed to parse and were skipped */
  readonly skippedCount: number;
  /** User-facing warning when skippedCount > 0, describing data incompleteness */
  readonly warning?: string;
}

/**
 * Get PR review comments from specific user
 *
 * Fetches inline code review comments (not PR comments) from a specific user
 * using GitHub API via gh CLI. These are comments on specific lines of code.
 *
 * Returns both the parsed comments and a count of any comments that failed to parse.
 * Callers should check skippedCount and warn users if review data is incomplete.
 *
 * @param prNumber - PR number to fetch review comments for
 * @param username - GitHub username to filter comments by
 * @param repo - Optional repository in "owner/repo" format
 * @returns Object with parsed comments array and count of skipped malformed comments
 * @throws {GitHubCliError} When API call fails or JSON parsing fails
 *
 * @example
 * ```typescript
 * const { comments, skippedCount } = await getPRReviewComments(123, "github-code-quality[bot]");
 * if (skippedCount > 0) {
 *   console.warn(`${skippedCount} comments could not be parsed - review data may be incomplete`);
 * }
 * console.log(`Found ${comments.length} code review comments`);
 * ```
 */
export async function getPRReviewComments(
  prNumber: number,
  username: string,
  repo?: string
): Promise<PRReviewCommentsResult> {
  const resolvedRepo = await resolveRepo(repo);
  // Escape username for safe use in jq filter string context
  const escapedUsername = username.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const result = await ghCli(
    [
      'api',
      `repos/${resolvedRepo}/pulls/${prNumber}/comments`,
      '--jq',
      `.[] | select(.user.login == "${escapedUsername}")`,
    ],
    {}
  );

  if (!result.trim()) {
    return { comments: [], skippedCount: 0 };
  }

  // Split by newlines and parse each JSON object
  const lines = result
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const comments: GitHubPRReviewComment[] = [];
  let skippedCount = 0;

  // Skip malformed comments with error logging instead of throwing
  // This ensures one bad comment doesn't block processing of all remaining valid comments
  // Design decision based on production incidents:
  //   - Issues #272, #319, #457, #465: Single malformed JSON blocked all review processing
  //   - Solution: Continue processing with error tracking to prevent total failure
  for (const line of lines) {
    try {
      comments.push(JSON.parse(line));
    } catch (error) {
      skippedCount++;
      // ERROR level - this is data loss that affects review completeness
      logger.error('Failed to parse review comment JSON - comment will be skipped', {
        prNumber,
        username,
        errorMessage: error instanceof Error ? error.message : String(error),
        linePreview: line.substring(0, 100),
        position: comments.length,
        totalSkipped: skippedCount,
        impact: 'Review data incomplete - some comments could not be parsed',
      });
    }
  }

  // Build warning and log summary if any comments were skipped
  let warning: string | undefined;
  if (skippedCount > 0) {
    const totalAttempted = comments.length + skippedCount;
    const skipPercentage = ((skippedCount / totalAttempted) * 100).toFixed(1);

    warning =
      `Warning: ${skippedCount} of ${totalAttempted} review comments (${skipPercentage}%) ` +
      `could not be parsed and were skipped. Review data may be incomplete.`;

    logger.error('Some review comments could not be parsed', {
      prNumber,
      username,
      parsedCount: comments.length,
      skippedCount,
      skipPercentage: `${skipPercentage}%`,
      userGuidance: warning,
    });
  }

  return { comments, skippedCount, warning };
}

/**
 * Sleep for a specified number of milliseconds
 *
 * Utility function for introducing delays, useful for retry logic and rate limiting.
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified delay
 *
 * @example
 * ```typescript
 * await sleep(1000); // Wait 1 second
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Node.js error codes that indicate retryable network/connection issues
 *
 * These are stable error codes from the Node.js error API, preferred over
 * string matching on error messages.
 */
const RETRYABLE_ERROR_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'EPIPE',
];

/**
 * Check if an error is retryable (network errors, 5xx server errors, rate limits)
 *
 * Determines if an error should be retried using a priority-based approach:
 * 1. Exit code (most reliable) - checks for known HTTP error codes
 * 2. Node.js error.code (stable API) - checks for network/connection errors
 * 3. Message pattern matching (fallback) - for when structured data is missing
 *
 * FRAGILITY WARNING - Message Parsing Limitations:
 * ------------------------------------------------
 * Why message parsing is needed:
 * - gh CLI sometimes wraps errors in generic Error objects where exitCode is undefined
 * - When structured exitCode is missing, HTTP status may still be embedded in error.message
 * - Error message format is not a stable API and changes between gh CLI versions
 * - We use string pattern matching as fallback when structured data is missing
 *
 * What to do when patterns stop matching (error classification fails):
 * 1. Check gh CLI release notes for error message format changes
 * 2. Look for new structured error types exposed by gh CLI (issue #453)
 * 3. Add new patterns based on observed error messages in logs (use logger.warn output)
 * 4. Test changes against both old and new gh CLI versions if possible
 *
 * Long-term fix (issue #453):
 * - Migrate to structured error types: RetryableError, RateLimitError, NetworkError
 * - Benefits: Type-safe error handling, no fragile message parsing, version-independent
 * - Blocked on: gh CLI exposing structured error types instead of wrapped Error objects
 *
 * @param error - Error to check for retryability
 * @param exitCode - Optional exit code from the CLI command
 * @returns true if error should be retried, false otherwise
 *
 * @example
 * ```typescript
 * try {
 *   await ghCli(['pr', 'view']);
 * } catch (error) {
 *   if (isRetryableError(error)) {
 *     // Retry the operation
 *   }
 * }
 * ```
 */
function isRetryableError(error: unknown, exitCode?: number): boolean {
  // Priority 1: Exit code (most reliable when available AND a valid HTTP status)
  // Checks for retryable HTTP codes (429, 502-504). When exitCode is defined:
  //   - If in retryable list -> returns true immediately
  //   - If NOT in retryable list -> continues to Priority 2/3 checks (does not assume non-retryable)
  // This allows network errors with non-retryable HTTP codes to still be retried.
  if (exitCode !== undefined) {
    if ([429, 502, 503, 504].includes(exitCode)) {
      return true;
    }
  }

  if (error instanceof Error) {
    // Priority 2: Node.js error codes (stable API)
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code && RETRYABLE_ERROR_CODES.includes(nodeError.code)) {
      return true;
    }

    // Priority 3: Message pattern matching (fallback, less reliable)
    // See comprehensive fragility documentation in function JSDoc above
    const msg = error.message.toLowerCase();
    const patterns = [
      // Network errors
      'network',
      'timeout',
      'socket',
      'connection',
      // Error codes as text - catches when error.code is missing or gh CLI wraps Node error in Error
      'econnreset',
      'econnrefused',
      // HTTP status codes (in case exitCode not provided)
      '429',
      '502',
      '503',
      '504',
      // Rate limit messages (multiple phrasings - fragile to changes)
      'rate limit',
      'api rate limit exceeded',
      'rate_limit_exceeded',
      'quota exceeded',
      'too many requests',
    ];

    return patterns.some((pattern) => msg.includes(pattern));
  }
  return false;
}

/**
 * Classify error type for logging and diagnostics
 *
 * Categorizes errors into types for pattern analysis and debugging.
 * Uses a priority-based approach:
 * 1. Exit code (most reliable when available)
 * 2. Node.js error codes (stable API)
 * 3. Message pattern matching (fallback, less reliable)
 *
 * @param error - Error to classify
 * @param exitCode - Optional exit code for more reliable classification
 * @returns Error type string (network, timeout, rate_limit, permission, not_found, server_error, unknown)
 */
function classifyErrorType(error: Error, exitCode?: number): string {
  // Priority 1: Use exit code for classification (most reliable)
  if (exitCode !== undefined) {
    if (exitCode === 429) return 'rate_limit';
    if ([502, 503, 504].includes(exitCode)) return 'server_error';
    if ([401, 403].includes(exitCode)) return 'permission';
    if (exitCode === 404) return 'not_found';
  }

  // Priority 2: Use Node.js error codes (stable API)
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code) {
    if (['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'ENOTFOUND'].includes(nodeError.code)) {
      return 'network';
    }
    if (nodeError.code === 'ETIMEDOUT') {
      return 'timeout';
    }
  }

  // Priority 3: Message pattern matching (fallback, less reliable)
  const msg = error.message.toLowerCase();

  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return 'network';
  }
  if (msg.includes('timeout') || msg.includes('etimedout')) {
    return 'timeout';
  }
  if (msg.includes('rate limit') || msg.includes('429')) {
    return 'rate_limit';
  }
  if (msg.includes('forbidden') || msg.includes('401') || msg.includes('403')) {
    return 'permission';
  }
  if (msg.includes('404') || msg.includes('not found')) {
    return 'not_found';
  }
  if (msg.includes('502') || msg.includes('503') || msg.includes('504')) {
    return 'server_error';
  }

  return 'unknown';
}

/**
 * Execute gh CLI command with retry logic
 *
 * Retries gh CLI commands for transient errors (network issues, timeouts, 5xx errors, rate limits).
 * Uses exponential backoff (2s, 4s, 8s). Logs retry attempts and final failures.
 * Non-retryable errors (like validation errors) fail immediately.
 *
 * @param args - GitHub CLI command arguments
 * @param options - Optional execution options
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns The stdout from the gh command
 * @throws {Error} When all retry attempts are exhausted or error is non-retryable
 *
 * @example
 * ```typescript
 * // Retry network-sensitive operations
 * const data = await ghCliWithRetry(['pr', 'view', '123'], {}, 5);
 * ```
 */
export async function ghCliWithRetry(
  args: string[],
  options?: GhCliOptions,
  maxRetries = 3
): Promise<string> {
  // Validate maxRetries to ensure loop executes at least once
  // This prevents the edge case where maxRetries < 1 would skip the loop entirely,
  // resulting in a confusing "Unexpected retry failure" error with no context
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    throw new GitHubCliError(
      `ghCliWithRetry: maxRetries must be a positive integer, got: ${maxRetries} (type: ${typeof maxRetries}). ` +
        `Command: gh ${args.join(' ')}`
    );
  }

  let lastError: Error | undefined;
  let firstError: Error | undefined;
  let lastExitCode: number | undefined;
  let firstExitCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await ghCli(args, options);

      // Success after retry - log recovery at WARN level for production visibility
      // INFO may be filtered in production, hiding important recovery patterns
      // Helps identify flaky endpoints or transient GitHub API issues
      // We log firstError (not lastError) because it's the initial failure that triggered the retry sequence
      if (attempt > 1 && firstError) {
        logger.warn('ghCliWithRetry: succeeded after retry - transient failure recovered', {
          attempt,
          totalAttempts: maxRetries,
          command: `gh ${args.join(' ')}`,
          initialErrorType: classifyErrorType(firstError, firstExitCode),
          initialErrorMessage: firstError.message,
          impact: 'Operation succeeded but was delayed by retry',
          action: 'Monitor this endpoint for consistent retry patterns',
        });
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Extract exitCode using duck-typing instead of instanceof GitHubCliError.
      // Duck-typing rationale:
      //   - Error may come from various error classes (GitHubCliError, execa.Error, or wrapped errors)
      //   - We can't rely on instanceof because error chain may lose type information
      //   - Duck-typing ({ exitCode?: number }) works for any object with exitCode property
      // Note: exitCode may be a subprocess exit code (e.g., 1=generic error, 127=command not found)
      // rather than HTTP status (429, 502). Subprocess codes occur when gh CLI fails before making
      // HTTP requests (validation errors, missing commands). These don't match retryable HTTP codes
      // and fall through to Priority 2/3 checks in isRetryableError(), which is correct behavior -
      // gh CLI failures before HTTP requests aren't transient network issues.
      //
      // exitCode may be undefined when:
      //   - Error is generic Error without exitCode (network timeouts, subprocess crashes)
      //   - gh CLI didn't set HTTP status before exiting
      //   - Error originated before CLI invocation (e.g., cwd resolution failure)
      // When undefined, we extract HTTP status from error message text as fallback.
      lastExitCode = (error as { exitCode?: number }).exitCode;
      if (lastExitCode === undefined && lastError.message) {
        // Try multiple patterns to extract HTTP status from error message
        // Different gh CLI versions and error contexts may format status differently
        const statusPatterns = [
          /HTTP\s+(\d{3})/i, // "HTTP 429"
          /status[:\s]+(\d{3})/i, // "status: 429" or "status 429"
          /(\d{3})\s+Too\s+Many/i, // "429 Too Many Requests"
          /rate\s+limit.*?(\d{3})/i, // "rate limit (429)" or "rate limit exceeded 429"
        ];

        for (const pattern of statusPatterns) {
          const statusMatch = lastError.message.match(pattern);
          if (statusMatch && statusMatch[1]) {
            const parsed = parseInt(statusMatch[1], 10);
            // Validate parsed exit code is a valid HTTP status code
            // - Must be finite (not Infinity or NaN from malformed input)
            // - Must be safe integer (no precision loss)
            // - Must be in valid HTTP status range (100-599)
            if (
              Number.isFinite(parsed) &&
              Number.isSafeInteger(parsed) &&
              parsed >= 100 &&
              parsed <= 599
            ) {
              lastExitCode = parsed;
              logger.debug('Extracted HTTP status from error message', {
                pattern: pattern.source,
                exitCode: parsed,
              });
              break;
            }
          }
        }

        // Log if no valid HTTP status code was extracted from error message
        if (lastExitCode === undefined) {
          // Check if error message suggests this SHOULD have had HTTP status
          const likelyHttpError = lastError.message.match(/\b(HTTP|status|429|502|503|504)\b/i);

          if (likelyHttpError) {
            // This looks like an HTTP error but we couldn't extract the status code
            logger.warn('Failed to extract HTTP status code from error that appears HTTP-related', {
              errorMessage: lastError.message,
              matchedPattern: likelyHttpError[0],
              impact: 'Falling back to message pattern matching for retry logic',
              action: 'Update status extraction patterns or check for gh CLI version changes',
            });
          } else {
            logger.debug('No valid HTTP status code found in error message', {
              errorMessage: lastError.message,
            });
          }
        }
      }

      // Capture first error for diagnostics
      if (attempt === 1) {
        firstError = lastError;
        firstExitCode = lastExitCode;
      }

      if (!isRetryableError(error, lastExitCode)) {
        // Non-retryable error, fail immediately
        throw lastError;
      }

      if (attempt === maxRetries) {
        // Final attempt failed - log all attempts exhausted
        logger.warn('ghCliWithRetry: all attempts failed', {
          maxRetries,
          command: `gh ${args.join(' ')}`,
          errorType: classifyErrorType(lastError, lastExitCode),
          exitCode: lastExitCode,
          errorMessage: lastError.message,
        });
        throw lastError;
      }

      // Log based on attempt number
      const errorType = classifyErrorType(lastError, lastExitCode);

      // Warn when error cannot be classified and we have no exit code
      // This indicates error message patterns may have changed or new error type encountered
      if (errorType === 'unknown' && lastExitCode === undefined) {
        logger.warn('Error classification unknown and no exit code extracted', {
          errorMessage: lastError.message,
          command: `gh ${args.join(' ')}`,
        });
      }

      if (attempt === 1) {
        // Initial failure - log at INFO level since retry is designed to handle transient errors
        // This reduces noise in logs when first attempt fails but retry succeeds
        logger.info('ghCliWithRetry: initial attempt failed, will retry', {
          attempt,
          maxRetries,
          command: `gh ${args.join(' ')}`,
          errorType,
          exitCode: lastExitCode,
          errorMessage: lastError.message,
        });
      } else {
        // Subsequent failures - log at WARN level
        logger.warn('ghCliWithRetry: retry attempt failed, will retry again', {
          attempt,
          maxRetries,
          command: `gh ${args.join(' ')}`,
          errorType,
          exitCode: lastExitCode,
          errorMessage: lastError.message,
        });
      }

      // Exponential backoff: 2^attempt seconds, capped at 60s
      // Examples: attempt 1->2s, 2->4s, 3->8s, 4->16s, 5->32s, 6->64s (capped to 60s)
      // Cap prevents impractical delays for high maxRetries values
      const MAX_DELAY_MS = 60000; // 60 seconds maximum delay
      const uncappedDelayMs = Math.pow(2, attempt) * 1000;
      const delayMs = Math.min(uncappedDelayMs, MAX_DELAY_MS);
      logger.debug('ghCliWithRetry: waiting before retry', {
        attempt,
        retryDelayMs: delayMs,
        wasCapped: uncappedDelayMs > MAX_DELAY_MS,
      });
      await sleep(delayMs);
    }
  }

  // This should be unreachable with maxRetries >= 1 validation above
  // If reached, provide full diagnostic context for debugging
  logger.error('INTERNAL: ghCliWithRetry loop completed without returning', {
    maxRetries,
    lastExitCode,
    command: `gh ${args.join(' ')}`,
    lastError: lastError?.message ?? 'none',
    impact: 'Programming error in retry logic',
  });
  throw (
    lastError ||
    new GitHubCliError(
      `INTERNAL ERROR: ghCliWithRetry loop completed without returning. ` +
        `This indicates a programming error in retry logic. ` +
        `Command: gh ${args.join(' ')}, maxRetries: ${maxRetries}, ` +
        `lastError: none, lastExitCode: ${lastExitCode ?? 'undefined'}`
    )
  );
}
