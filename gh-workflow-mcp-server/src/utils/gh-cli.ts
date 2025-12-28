/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError, ParsingError } from './errors.js';
import {
  PR_CHECK_IN_PROGRESS_STATES,
  PR_CHECK_TERMINAL_STATES,
  PR_CHECK_TERMINAL_STATE_MAP,
} from '../constants.js';

export interface GhCliOptions {
  repo?: string;
  timeout?: number;
}

/**
 * Execute a GitHub CLI command safely with proper error handling
 */
export async function ghCli(args: string[], options: GhCliOptions = {}): Promise<string> {
  try {
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
    };

    const fullArgs = options.repo ? ['--repo', options.repo, ...args] : args;

    const result = await execa('gh', fullArgs, execaOptions);

    if (result.exitCode !== 0) {
      throw new GitHubCliError(
        `GitHub CLI command failed: ${result.stderr || result.stdout}`,
        result.exitCode,
        result.stderr || undefined
      );
    }

    return result.stdout || '';
  } catch (error) {
    // Preserve GitHubCliError instances - already properly wrapped
    if (error instanceof GitHubCliError) {
      throw error;
    }

    // Handle known operational error types from execa
    if (error instanceof Error) {
      // Check for timeout from execa (timedOut property)
      if ('timedOut' in error && (error as { timedOut?: boolean }).timedOut) {
        throw new GitHubCliError(
          `GitHub CLI command timed out after ${options.timeout}ms: gh ${args.join(' ')}`,
          undefined,
          undefined,
          undefined,
          error
        );
      }

      // Check for signal termination (SIGKILL, SIGTERM, etc.)
      if ('signal' in error && (error as { signal?: string }).signal) {
        throw new GitHubCliError(
          `GitHub CLI command terminated by signal: ${(error as { signal: string }).signal}`,
          undefined,
          undefined,
          undefined,
          error
        );
      }

      // Generic operational error
      // TODO(#443): Add operational vs programming error classification metadata
      throw new GitHubCliError(
        `Failed to execute gh CLI: ${error.message}`,
        undefined,
        undefined,
        undefined,
        error
      );
    }

    // Unknown error type - likely programming error, log for diagnosis
    const errorType = typeof error;
    const errorStr = String(error);
    console.error('[gh-workflow] WARN ghCli caught unexpected error type', {
      error,
      errorType,
      args,
    });
    // Include full diagnostic context in thrown error for debugging
    throw new GitHubCliError(
      `Failed to execute gh CLI (unexpected error type):\n` +
        `Command: gh ${args.join(' ')}\n` +
        `Error type: ${errorType}\n` +
        `Error value: ${errorStr}\n` +
        `This indicates a programming error (non-Error thrown).`
    );
  }
}

/**
 * Execute a GitHub CLI command and parse JSON output
 */
export async function ghCliJson<T>(args: string[], options: GhCliOptions = {}): Promise<T> {
  const output = await ghCli(args, options);

  try {
    return JSON.parse(output) as T;
  } catch (error) {
    // Provide context about what command failed and show output snippet
    const outputSnippet = output.length > 200 ? output.substring(0, 200) + '...' : output;
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ParsingError(
      `Failed to parse JSON response from gh CLI: ${errorMessage}\n` +
        `Command: gh ${args.join(' ')}\n` +
        `Output (first 200 chars): ${outputSnippet}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Get the current repository in format "owner/repo"
 */
export async function getCurrentRepo(): Promise<string> {
  try {
    const result = await ghCli(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    return result.trim();
  } catch (error) {
    // Preserve original error details for debugging while providing user-friendly message
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
 */
export async function resolveRepo(repo?: string): Promise<string> {
  if (repo) {
    return repo;
  }
  return getCurrentRepo();
}

/**
 * Get workflow run by ID
 */
export async function getWorkflowRun(runId: number, repo?: string) {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson(
    [
      'run',
      'view',
      runId.toString(),
      '--json',
      'databaseId,name,status,conclusion,url,createdAt,updatedAt,workflowName',
    ],
    { repo: resolvedRepo }
  );
}

/**
 * Get logs from failed steps only using `gh run view --log-failed`.
 *
 * This command filters logs to only show output from steps that failed,
 * making it much easier to identify the root cause of failures without
 * wading through successful step output.
 *
 * Output format: "job-name\tstep-name\ttimestamp log-line"
 *
 * Note: Only works for completed workflow runs. For in-progress runs,
 * this will fail or return incomplete data.
 *
 * @param runId - Workflow run ID
 * @param repo - Repository in format "owner/repo"
 * @returns Tab-delimited log output from failed steps
 * @throws GitHubCliError if run is still in progress or has no failed steps
 */
export async function getFailedStepLogs(runId: number, repo?: string): Promise<string> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCli(['run', 'view', runId.toString(), '--log-failed'], { repo: resolvedRepo });
}

/**
 * Parsed failed step log entry
 */
export interface FailedStepLog {
  /** Name of the job containing the failed step */
  jobName: string;
  /** Name of the failed step */
  stepName: string;
  /** Log lines from this failed step */
  lines: string[];
}

/**
 * Result of parsing failed step logs
 *
 * Includes data completeness information to allow callers to warn users
 * when failure diagnosis may be incomplete due to parsing issues.
 *
 * Note: totalLines counts only non-empty lines. Empty lines are silently
 * skipped and not included in totalLines or skippedLines counts. Rationale:
 * Empty lines are common in log output (formatting, separation) and are not
 * data loss - skipping them prevents false positives in data completeness warnings.
 */
export interface FailedStepLogsResult {
  /** Parsed failed step logs grouped by job and step */
  readonly steps: FailedStepLog[];
  /** Total number of non-empty lines in the log output */
  readonly totalLines: number;
  /** Number of lines that could not be parsed */
  readonly skippedLines: number;
  /** Ratio of successfully parsed lines (0.0 to 1.0) */
  readonly successRate: number;
  /** Whether all lines were parsed successfully (skippedLines === 0) */
  readonly isComplete: boolean;
  /** User-facing warning when data is incomplete (undefined if complete) */
  readonly warning?: string;
}

/**
 * Parse tab-delimited output from `gh run view --log-failed`
 *
 * Expected format: Each line contains three tab-separated fields:
 * "job-name\tstep-name\ttimestamp log-line"
 *
 * This function groups log lines by job and step for easier processing.
 * Returns data completeness information to allow callers to warn users
 * when failure diagnosis may be incomplete.
 *
 * Parsing quality validation:
 * - Warns (stderr) if ANY lines cannot be parsed (even 1 skipped line)
 * - Throws ParsingError if success rate < 70% (more than 30% of lines unparseable)
 * - Empty lines are silently skipped and not counted toward totalLines or skippedLines
 *
 * @param output - Raw output from `gh run view --log-failed`
 * @returns Result object with parsed steps and completeness metadata
 * @throws {ParsingError} If fewer than 70% of non-empty lines parse successfully
 */
export function parseFailedStepLogs(output: string): FailedStepLogsResult {
  const steps: Map<string, FailedStepLog> = new Map();
  let skippedCount = 0;

  for (const line of output.split('\n')) {
    // Skip empty lines silently (common, not an error)
    if (!line.trim()) continue;

    // Split by first two tabs only
    const firstTab = line.indexOf('\t');
    if (firstTab === -1) {
      skippedCount++;
      console.error(
        `[gh-workflow] DEBUG Skipping log line missing first tab delimiter (linePreview: ${line.substring(0, 100)}, lineLength: ${line.length})`
      );
      continue;
    }

    const secondTab = line.indexOf('\t', firstTab + 1);
    if (secondTab === -1) {
      skippedCount++;
      console.error(
        `[gh-workflow] DEBUG Skipping log line missing second tab delimiter (linePreview: ${line.substring(0, 100)}, lineLength: ${line.length})`
      );
      continue;
    }

    const jobName = line.substring(0, firstTab);
    const stepName = line.substring(firstTab + 1, secondTab);
    const content = line.substring(secondTab + 1);

    // Group by unique job::step combination
    const key = `${jobName}::${stepName}`;
    if (!steps.has(key)) {
      steps.set(key, { jobName, stepName, lines: [] });
    }
    steps.get(key)!.lines.push(content);
  }

  // Calculate parsing statistics for threshold validation
  const totalLines = output.split('\n').filter((l) => l.trim()).length;
  const successCount = totalLines - skippedCount;
  const successRate = totalLines > 0 ? successCount / totalLines : 1;
  const MIN_SUCCESS_RATE = 0.7; // At least 70% of lines must parse successfully

  // Warn on ANY data loss - even one skipped line affects failure diagnosis
  // This logs to stderr but doesn't fail unless threshold is exceeded (see below)
  if (skippedCount > 0) {
    const skipRate = totalLines > 0 ? (skippedCount / totalLines) * 100 : 0;

    // Always use WARN level - any data loss affects failure diagnosis
    console.error(
      `[gh-workflow] WARN Log parsing incomplete: ${skippedCount}/${totalLines} lines (${skipRate.toFixed(1)}%) could not be parsed (impact: Some failure details may be missing, action: Check stderr for individual malformed line details, suggestion: If this persists check for gh CLI format changes)`
    );
  }

  // Fail only if parsing quality is too poor (< 70% success rate)
  // This catches gh CLI format changes or severe log corruption
  // The threshold allows minor parsing issues while catching severe format problems
  if (totalLines > 0 && successRate < MIN_SUCCESS_RATE) {
    console.error(
      `[gh-workflow] ERROR Log parsing failed below threshold (successRate: ${(successRate * 100).toFixed(1)}%, threshold: ${(MIN_SUCCESS_RATE * 100).toFixed(1)}%, skipped: ${skippedCount}/${totalLines})`
    );

    throw new ParsingError(
      `Failed to parse workflow logs: ${((1 - successRate) * 100).toFixed(1)}% of lines could not be parsed.\n` +
        `This indicates a format change in GitHub CLI output or log corruption.\n` +
        `Parsed ${steps.size} steps from ${successCount} lines.\n` +
        `Check for:\n` +
        `  1. Recent gh CLI version updates (run: gh --version)\n` +
        `  2. Workflow log corruption (check: gh run view --log-failed manually)\n` +
        `  3. Non-standard workflow step output (custom actions, binary data)`
    );
  }

  // Build result with completeness metadata
  const isComplete = skippedCount === 0;
  const warning =
    skippedCount > 0
      ? `Warning: ${skippedCount}/${totalLines} log lines could not be parsed. ` +
        `Failure diagnosis may be incomplete. Review stderr for details.`
      : undefined;

  return {
    steps: Array.from(steps.values()),
    totalLines,
    skippedLines: skippedCount,
    successRate,
    isComplete,
    warning,
  };
}

/**
 * Get workflow runs for a branch
 */
export async function getWorkflowRunsForBranch(
  branch: string,
  repo?: string,
  limit = 1
): Promise<any[]> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson<any[]>(
    [
      'run',
      'list',
      '--branch',
      branch,
      '--limit',
      limit.toString(),
      '--json',
      'databaseId,name,status,conclusion,url,createdAt,updatedAt,workflowName,headSha',
    ],
    { repo: resolvedRepo }
  );
}

/**
 * Get the HEAD commit SHA for a branch
 */
export async function getBranchHeadSha(branch: string, repo?: string): Promise<string> {
  const resolvedRepo = await resolveRepo(repo);
  const result = await ghCli(
    ['api', `repos/${resolvedRepo}/branches/${branch}`, '--jq', '.commit.sha'],
    {} // No repo flag needed - it's in the API path
  );
  return result.trim();
}

/**
 * Get all workflow runs for a specific commit SHA
 *
 * This function retrieves ALL workflow runs matching a commit SHA, regardless of trigger event.
 * Unlike getWorkflowRunsForBranch, this catches workflows triggered by "dynamic" events
 * (like CodeQL analysis) that don't appear in branch-filtered queries.
 *
 * @param headSha - The commit SHA to filter runs by
 * @param repo - Repository in format "owner/repo"
 * @param limit - Maximum number of runs to fetch (default: 20)
 * @returns Array of workflow runs matching the commit SHA
 */
export async function getWorkflowRunsForCommit(
  headSha: string,
  repo?: string,
  limit = 20
): Promise<any[]> {
  const resolvedRepo = await resolveRepo(repo);
  const allRuns = await ghCliJson<any[]>(
    [
      'run',
      'list',
      '--limit',
      limit.toString(),
      '--json',
      'databaseId,name,status,conclusion,url,createdAt,updatedAt,workflowName,headSha,event',
    ],
    { repo: resolvedRepo }
  );

  // Filter to only runs matching the target commit SHA
  return allRuns.filter((run) => run.headSha === headSha);
}

/**
 * Result of mapping a PR check state to workflow run status
 */
export interface StateToStatusResult {
  /** Normalized workflow run status ("in_progress" or "completed") */
  status: string;
  /** The unknown state if one was encountered (for surfacing to users) */
  unknownState?: string;
}

/**
 * Map PR check state to workflow run status
 *
 * GitHub's `gh pr checks` API returns check states (PENDING, QUEUED, IN_PROGRESS, WAITING, SUCCESS, FAILURE, etc.)
 * that differ from workflow run statuses (in_progress, completed). This mapping normalizes PR check states
 * to the workflow run status format used by the monitoring tools.
 *
 * Mapping rationale:
 * - PENDING/QUEUED/IN_PROGRESS/WAITING → "in_progress": Actively running or queued checks
 * - SUCCESS/FAILURE/ERROR/CANCELLED/SKIPPED/STALE → "completed": Known terminal states
 * - Unknown states → "in_progress": Conservative default to continue monitoring. If GitHub adds
 *                                   new terminal states, monitoring will continue until timeout.
 *                                   This is safer than the optimistic "completed" default which
 *                                   could exit monitoring prematurely and report incomplete results.
 *
 * Source: GitHub CLI `gh pr checks` command returns CheckRun states from the GitHub API
 * Possible values: PENDING, QUEUED, IN_PROGRESS, WAITING, SUCCESS, FAILURE, ERROR, CANCELLED, SKIPPED, STALE
 *
 * @param state - The PR check state from GitHub API (uppercase format)
 * @returns Object with normalized status and optional unknownState for surfacing to users
 */
export function mapStateToStatus(state: string): StateToStatusResult {
  if (PR_CHECK_IN_PROGRESS_STATES.includes(state)) {
    return { status: 'in_progress' };
  }

  if (PR_CHECK_TERMINAL_STATES.includes(state)) {
    return { status: 'completed' };
  }

  // Unknown state - log at ERROR level and default to conservative 'in_progress'
  // This ensures monitoring continues rather than exiting prematurely with incomplete results
  // Also return the unknown state so callers can surface it to users
  console.error(
    `[gh-workflow] ERROR mapStateToStatus: Unknown GitHub check state encountered: ${state}. ` +
      `Defaulting to 'in_progress' to avoid premature exit. ` +
      `Action: Add '${state}' to known states in constants.ts if this is a valid terminal state.`
  );

  return { status: 'in_progress', unknownState: state };
}

/**
 * Map PR check state to workflow run conclusion
 *
 * GitHub's `gh pr checks` returns terminal states (SUCCESS, FAILURE, etc.) that need to be mapped
 * to workflow run conclusions (success, failure, cancelled, skipped). This mapping ensures consistency
 * with the workflow run format used throughout the monitoring tools.
 *
 * Full state-to-conclusion mapping:
 * - SUCCESS → "success": Check passed successfully
 * - FAILURE → "failure": Check failed due to test/build failures
 * - ERROR → "failure": Check encountered an error (system failure, mapped to "failure" for consistency)
 * - CANCELLED → "cancelled": Check was explicitly cancelled by user or system
 * - SKIPPED → "skipped": Check was skipped (conditional execution, path filters, etc.)
 * - STALE → "skipped": Check is outdated/stale (treated as skipped since it won't complete)
 * - In-progress states (PENDING, QUEUED, IN_PROGRESS, WAITING) → null: No conclusion yet
 *
 * Edge cases:
 * - ERROR maps to "failure" rather than having a separate conclusion to align with how errors are typically
 *   treated in CI/CD systems (as failures requiring attention)
 * - STALE maps to "skipped" because stale checks won't complete and are effectively superseded by newer runs
 *
 * @param state - The PR check state from GitHub API (uppercase format)
 * @returns Workflow run conclusion string for terminal states, null for in-progress states
 */
export function mapStateToConclusion(state: string): string | null {
  return PR_CHECK_TERMINAL_STATE_MAP[state] || null;
}

/**
 * Result of getting workflow runs for a PR, including any warnings about unknown states
 */
export interface WorkflowRunsForPRResult {
  /** Array of workflow runs mapped from PR checks */
  runs: any[];
  /** Unknown GitHub check states encountered during mapping (for surfacing to users) */
  unknownStates: string[];
}

/**
 * Get workflow runs for a PR
 *
 * @returns Object with runs array and any unknown states encountered for surfacing to users
 */
export async function getWorkflowRunsForPR(
  prNumber: number,
  repo?: string
): Promise<WorkflowRunsForPRResult> {
  const resolvedRepo = await resolveRepo(repo);
  const checks = await ghCliJson<any[]>(
    [
      'pr',
      'checks',
      prNumber.toString(),
      '--json',
      'name,state,link,startedAt,completedAt,workflow',
    ],
    { repo: resolvedRepo }
  );

  // Track unknown states to surface to users
  const unknownStates = new Set<string>();

  // Map gh pr checks format to workflow run format
  const runs = checks.map((check: any) => {
    const statusResult = mapStateToStatus(check.state);
    if (statusResult.unknownState) {
      unknownStates.add(statusResult.unknownState);
    }
    return {
      name: check.name,
      status: statusResult.status,
      conclusion: mapStateToConclusion(check.state),
      detailsUrl: check.link,
      startedAt: check.startedAt,
      completedAt: check.completedAt,
      workflowName: check.workflow,
    };
  });

  return {
    runs,
    unknownStates: Array.from(unknownStates),
  };
}

/**
 * Get PR details
 */
export async function getPR(prNumber: number, repo?: string) {
  const resolvedRepo = await resolveRepo(repo);
  // TODO(#349): Improve JSON parsing resilience - see PR #273 review
  // Current: Throws on first malformed JSON, blocking all subsequent comments
  // Recommended: Skip malformed lines with logging instead of throwing
  return ghCliJson(
    [
      'pr',
      'view',
      prNumber.toString(),
      '--json',
      'number,title,state,url,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus',
    ],
    { repo: resolvedRepo }
  );
}

/**
 * Get logs for a specific job, with optional truncation for large logs.
 * Uses GitHub API directly to fetch logs for completed jobs even when
 * the overall workflow run is still in progress.
 */
export async function getJobLogs(
  _runId: number, // Unused - kept for API compatibility
  jobId: number,
  repo?: string,
  tailLines = 2000
): Promise<string> {
  const resolvedRepo = await resolveRepo(repo);

  // Use GitHub API directly - this allows fetching logs for completed jobs
  // even when the overall workflow run is still in progress.
  // The `gh run view --log` command blocks until the entire run completes.
  const fullLogs = await ghCliWithRetry(
    ['api', `repos/${resolvedRepo}/actions/jobs/${jobId}/logs`],
    {} // No repo flag needed - it's in the API path
  );

  const lines = fullLogs.split('\n');
  if (lines.length > tailLines) {
    const truncatedCount = lines.length - tailLines;
    return `... (${truncatedCount} lines truncated)\n` + lines.slice(-tailLines).join('\n');
  }
  return fullLogs;
}

/**
 * Get all jobs for a workflow run
 */
export async function getWorkflowJobs(runId: number, repo?: string) {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson(['run', 'view', runId.toString(), '--json', 'jobs'], { repo: resolvedRepo });
}

/**
 * Sleep for a specified number of milliseconds
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
 * Determines if an error should be retried using multiple detection methods:
 * 1. Exit code (most reliable when available) - checks for HTTP codes 429, 502-504
 * 2. Node.js error.code (stable API) - checks for network error codes (ECONNRESET, etc.)
 * 3. Message pattern matching (least reliable) - checks error message text
 * All three methods are checked; if ANY indicate retryable error, returns true.
 *
 * Current limitation: gh CLI wraps errors in generic Error objects, losing HTTP
 * status codes and error types. We must parse error messages, which are fragile
 * to GitHub CLI updates. See issue #453 for migration to structured error types.
 *
 * @param error - Error to check for retryability
 * @param exitCode - Optional exit code from the CLI command
 * @returns true if error should be retried, false otherwise
 */
// TODO(#453): Migrate to structured error types for type-safe error handling
// Current blocker: gh CLI wraps errors in generic Error objects, losing type information.
// We must rely on exitCode parameter and message pattern matching until gh CLI preserves error types.
// When fixed: Replace pattern matching with `instanceof NetworkError`, `instanceof RateLimitError`, etc.
// Benefits: Type-safe error handling, eliminate fragile message parsing
function isRetryableError(error: unknown, exitCode?: number): boolean {
  // Priority 1: Exit code (most reliable when available)
  // Note: gh CLI uses HTTP status codes as process exit codes (e.g., exit code 429 for rate limit).
  // While Unix convention suggests exit codes 0-255, gh CLI intentionally uses HTTP codes (100-599).
  // We check for known retryable HTTP status codes; all other codes fall through to subsequent checks.
  if (exitCode !== undefined) {
    if ([429, 502, 503, 504].includes(exitCode)) {
      return true;
    }
  }

  if (error instanceof Error) {
    // Priority 2: Node.js error codes (stable API, but less specific than exit codes)
    // These indicate low-level network/system errors that are usually retryable
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code && RETRYABLE_ERROR_CODES.includes(nodeError.code)) {
      return true;
    }

    // Priority 3: Message pattern matching (fallback, less reliable)
    // FRAGILE: gh CLI error message format is not a stable API and can change between versions
    // If patterns stop matching, check:
    //   1. gh CLI release notes for error message changes
    //   2. Whether gh CLI now exposes structured error types (see issue #453)
    //   3. Add new patterns based on observed error messages in logs
    // Long-term fix: Migrate to structured error types (issue #453)
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

// TODO(#389): Replace console.error with structured logger for retry monitoring
/**
 * Execute gh CLI command with retry logic
 *
 * Retries gh CLI commands for transient errors (network issues, timeouts, 5xx errors, rate limits).
 * Uses exponential backoff (2s, 4s, 8s). Logs retry attempts and final failures.
 * Non-retryable errors (like validation errors) fail immediately.
 *
 * Note: All logging uses console.error() to ensure visibility in MCP stderr streams.
 * The INFO/WARN/DEBUG prefixes in messages indicate severity for human readers.
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
      // Uses console.error to ensure visibility even when stdout is redirected
      // We log firstError (not lastError) because it's the initial failure that triggered the retry sequence
      if (attempt > 1 && firstError) {
        console.error(
          `[gh-workflow] WARN ghCliWithRetry: succeeded after retry - transient failure recovered (attempt ${attempt}/${maxRetries}, errorType: ${classifyErrorType(firstError, firstExitCode)}, command: gh ${args.join(' ')}, impact: Operation delayed by retry, action: Monitor for consistent retry patterns)`
        );
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Attempt to extract exit code from error object (duck-typed - works for GitHubCliError and similar types)
      // Note: exitCode may be undefined if:
      //   - Error object doesn't have exitCode property (e.g., generic Error, network timeout)
      //   - gh CLI exited without setting HTTP status (e.g., subprocess crash)
      //   - Error originated from ghCli() wrapper before CLI invocation
      // Fallback: Parse HTTP status from error message using multiple patterns
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
              console.error(
                `[gh-workflow] DEBUG Extracted HTTP status from error message (pattern: ${pattern.source}, exitCode: ${parsed})`
              );
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
            console.error(
              `[gh-workflow] WARN Failed to extract HTTP status code from error that appears HTTP-related (errorMessage: ${lastError.message}, matchedPattern: ${likelyHttpError[0]}, impact: Falling back to message pattern matching for retry logic, action: Update status extraction patterns or check for gh CLI version changes)`
            );
          } else {
            console.error(
              `[gh-workflow] DEBUG No valid HTTP status code found in error message (errorMessage: ${lastError.message})`
            );
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
        // Note: Error context already logged to stderr in the console.error call below
        console.error(
          `[gh-workflow] ghCliWithRetry: non-retryable error encountered (attempt ${attempt}/${maxRetries}, errorType: ${classifyErrorType(lastError, lastExitCode)}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')})`
        );
        throw lastError;
      }

      if (attempt === maxRetries) {
        // Final attempt failed - log all attempts exhausted with full context
        console.error(
          `[gh-workflow] ghCliWithRetry: all attempts failed (maxRetries: ${maxRetries}, errorType: ${classifyErrorType(lastError, lastExitCode)}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
        throw lastError;
      }

      // Log retry attempts with consistent formatting and full context
      const errorType = classifyErrorType(lastError, lastExitCode);

      // Warn when error cannot be classified and we have no exit code
      // This indicates error message patterns may have changed or new error type encountered
      if (errorType === 'unknown' && lastExitCode === undefined) {
        console.error(
          `[gh-workflow] WARN Error classification unknown and no exit code extracted (errorMessage: ${lastError.message}, command: gh ${args.join(' ')})`
        );
      }

      if (attempt === 1) {
        // Initial failure - log at INFO level since retry is designed to handle transient errors
        // This reduces noise in logs when first attempt fails but retry succeeds
        console.error(
          `[gh-workflow] INFO ghCliWithRetry: initial attempt failed, will retry (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      } else {
        // Subsequent failures - WARN level to indicate multiple failures
        console.error(
          `[gh-workflow] WARN ghCliWithRetry: retry attempt failed, will retry again (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      }

      // Exponential backoff: 2^(attempt) * 1000 milliseconds, capped at 60s
      // Attempts are 1-based. Examples: attempt=1->2s, attempt=2->4s, attempt=3->8s,
      // attempt=4->16s, attempt=5->32s, attempt=6->60s (capped)
      // Cap prevents impractical delays for high maxRetries values
      const MAX_DELAY_MS = 60000; // 60 seconds maximum delay
      const uncappedDelayMs = Math.pow(2, attempt) * 1000;
      const delayMs = Math.min(uncappedDelayMs, MAX_DELAY_MS);
      await sleep(delayMs);
    }
  }

  // This should be unreachable with maxRetries >= 1 validation above
  // If reached, provide full diagnostic context for debugging
  console.error(
    `[gh-workflow] ERROR INTERNAL: ghCliWithRetry loop completed without returning (maxRetries: ${maxRetries}, lastExitCode: ${lastExitCode}, command: gh ${args.join(' ')}, lastError: ${lastError?.message ?? 'none'})`
  );
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
