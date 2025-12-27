/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from 'execa';
import { GitHubCliError, ParsingError } from './errors.js';
import { PR_CHECK_IN_PROGRESS_STATES, PR_CHECK_TERMINAL_STATE_MAP } from '../constants.js';

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

    // Add repo flag if provided
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
    // TODO: See issue #443 - Distinguish programming errors from operational errors
    if (error instanceof GitHubCliError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new GitHubCliError(
        `Failed to execute gh CLI: ${error.message}`,
        undefined,
        undefined,
        undefined,
        error
      );
    }
    throw new GitHubCliError(`Failed to execute gh CLI: ${String(error)}`);
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
  // TODO(#463): Preserve original error diagnostic information when rethrowing
  try {
    const result = await ghCli(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    return result.trim();
  } catch (error) {
    throw new GitHubCliError(
      "Failed to get current repository. Make sure you're in a git repository or provide the --repo flag."
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
 * Parse tab-delimited output from `gh run view --log-failed`
 *
 * The GitHub CLI outputs failed step logs in a tab-delimited format:
 * "job-name\tstep-name\ttimestamp log-line"
 *
 * This function groups log lines by job and step for easier processing.
 *
 * **Important**: Malformed lines (missing tabs) are silently skipped.
 * See issue #454 for debug logging enhancement.
 *
 * @param output - Raw output from `gh run view --log-failed`
 * @returns Array of failed step logs grouped by job and step
 */
export function parseFailedStepLogs(output: string): FailedStepLog[] {
  const steps: Map<string, FailedStepLog> = new Map();

  // TODO: See issue #454 - Add debug logging for skipped malformed log lines
  for (const line of output.split('\n')) {
    // Split by first two tabs only
    const firstTab = line.indexOf('\t');
    if (firstTab === -1) continue;

    const secondTab = line.indexOf('\t', firstTab + 1);
    if (secondTab === -1) continue;

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

  return Array.from(steps.values());
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
 * Map PR check state to workflow run status
 *
 * GitHub's `gh pr checks` API returns check states (PENDING, QUEUED, IN_PROGRESS, WAITING, SUCCESS, FAILURE, etc.)
 * that differ from workflow run statuses (in_progress, completed). This mapping normalizes PR check states
 * to the workflow run status format used by the monitoring tools.
 *
 * Mapping rationale:
 * - PENDING/QUEUED/IN_PROGRESS/WAITING → "in_progress": Actively running or queued checks
 * - SUCCESS/FAILURE/ERROR/CANCELLED/SKIPPED/STALE → "completed": Known terminal states
 * - Unknown states → "completed": Conservative default (treats unrecognized states as terminal)
 *
 * Source: GitHub CLI `gh pr checks` command returns CheckRun states from the GitHub API
 * Possible values: PENDING, QUEUED, IN_PROGRESS, WAITING, SUCCESS, FAILURE, ERROR, CANCELLED, SKIPPED, STALE
 *
 * @param state - The PR check state from GitHub API (uppercase format)
 * @returns Normalized workflow run status ("in_progress" or "completed")
 */
export function mapStateToStatus(state: string): string {
  return PR_CHECK_IN_PROGRESS_STATES.includes(state) ? 'in_progress' : 'completed';
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
 * Get workflow runs for a PR
 */
export async function getWorkflowRunsForPR(prNumber: number, repo?: string): Promise<any[]> {
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

  // Map gh pr checks format to workflow run format
  return checks.map((check: any) => ({
    name: check.name,
    status: mapStateToStatus(check.state),
    conclusion: mapStateToConclusion(check.state),
    detailsUrl: check.link,
    startedAt: check.startedAt,
    completedAt: check.completedAt,
    workflowName: check.workflow,
  }));
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
 * Determines if an error should be retried using a priority-based approach:
 * 1. Exit code (most reliable) - checks for known HTTP error codes
 * 2. Node.js error.code (stable API) - checks for network/connection errors
 * 3. Message pattern matching (fallback) - for when structured data is missing
 *
 * Current limitation: gh CLI wraps errors in generic Error objects, losing HTTP
 * status codes and error types. We must parse error messages, which are fragile
 * to GitHub CLI updates. See issue #453 for migration to structured error types.
 *
 * @param error - Error to check for retryability
 * @param exitCode - Optional exit code from the CLI command
 * @returns true if error should be retried, false otherwise
 */
// TODO: See issue #453 - Use error types instead of string matching for retry logic
function isRetryableError(error: unknown, exitCode?: number): boolean {
  // Priority 1: Exit code (most reliable when available)
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
    // This is fragile - error messages can change with GitHub CLI versions
    const msg = error.message.toLowerCase();
    const patterns = [
      // Network errors
      'network',
      'timeout',
      'socket',
      'connection',
      'econnreset', // Fallback if error.code missing
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
 */
export async function ghCliWithRetry(
  args: string[],
  options?: GhCliOptions,
  maxRetries = 3
): Promise<string> {
  let lastError: Error | undefined;
  let firstError: Error | undefined;
  let lastExitCode: number | undefined;
  let firstExitCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await ghCli(args, options);

      // Success after retry - log recovery with first error type for diagnostics
      // We log firstError (not lastError) because it's the initial failure that triggered the retry sequence
      if (attempt > 1 && firstError) {
        console.error(
          `[gh-workflow] INFO ghCliWithRetry: succeeded after retry (attempt ${attempt}/${maxRetries}, errorType: ${classifyErrorType(firstError, firstExitCode)}, command: gh ${args.join(' ')})`
        );
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Extract exit code from GitHubCliError (which has an exitCode property)
      // or try to parse HTTP status from error message as fallback
      lastExitCode = (error as { exitCode?: number }).exitCode;
      if (lastExitCode === undefined && lastError.message) {
        // Fallback: try to extract HTTP status from error message (e.g., "HTTP 429")
        const statusMatch = lastError.message.match(/HTTP\s+(\d{3})/i);
        if (statusMatch) {
          lastExitCode = parseInt(statusMatch[1], 10);
        }
      }

      // Capture first error for diagnostics
      if (attempt === 1) {
        firstError = lastError;
        firstExitCode = lastExitCode;
      }

      if (!isRetryableError(error, lastExitCode)) {
        // Non-retryable error, fail immediately with context
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
      // Note: Using console.error() for all logs to ensure visibility in MCP stderr streams
      // The INFO/WARN prefixes in the message indicate severity for human readers
      const errorType = classifyErrorType(lastError, lastExitCode);
      if (attempt === 1) {
        // Initial failure - INFO level since retry is designed for this
        console.error(
          `[gh-workflow] INFO ghCliWithRetry: initial attempt failed, will retry (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      } else {
        // Subsequent failures - WARN level to indicate multiple failures
        console.error(
          `[gh-workflow] WARN ghCliWithRetry: retry attempt failed, will retry again (attempt ${attempt}/${maxRetries}, errorType: ${errorType}, exitCode: ${lastExitCode}, command: gh ${args.join(' ')}, error: ${lastError.message})`
        );
      }

      // Exponential backoff: 2^attempt seconds (attempt 1→2s, 2→4s, 3→8s)
      const delayMs = Math.pow(2, attempt) * 1000;
      await sleep(delayMs);
    }
  }

  throw lastError || new Error('Unexpected retry failure');
}
