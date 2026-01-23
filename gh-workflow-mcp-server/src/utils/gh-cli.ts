/**
 * GitHub CLI wrapper utilities for safe command execution
 */

// TODO(#958): Use string literal union for WorkflowStatus in StateToStatusResult
// TODO(#936): Improve parseFailedStepLogs error handling with actionable recovery steps
// TODO(#843): Document FailedStepLogsResult warning field usage contract
// TODO(#791): Improve JSDoc clarity for ghCliWithRetry logging note
// TODO(#349): gh-workflow-mcp: Improve JSON parsing resilience in getPRReviewComments
import { execa } from 'execa';
import { GitHubCliError, ParsingError } from './errors.js';
import {
  PR_CHECK_IN_PROGRESS_STATES,
  PR_CHECK_TERMINAL_STATES,
  PR_CHECK_TERMINAL_STATE_MAP,
} from '../constants.js';
import {
  ghCliWithRetry as sharedGhCliWithRetry,
  sleep as sharedSleep,
  type GhCliWithRetryOptions,
} from '@commons/mcp-common/gh-retry';

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
    // Capture stack trace at the catch point for debugging since non-Error values don't have stacks
    const capturedStack = new Error('Stack trace for unknown error type').stack;
    const errorType = typeof error;
    const errorStr = String(error);

    // Safely serialize error for logging - handle objects that don't JSON.stringify cleanly
    let errorSerialized: string;
    try {
      errorSerialized = JSON.stringify(error, null, 2);
    } catch (_serializeError) {
      // Fallback for objects with circular references or non-enumerable properties
      errorSerialized = errorStr;
    }

    console.error(
      '[gh-workflow] WARN ghCli caught unexpected error type',
      JSON.stringify(
        {
          errorType,
          errorString: errorStr,
          errorSerialized,
          args,
          capturedStack,
        },
        null,
        2
      )
    );
    // Include full diagnostic context in thrown error for debugging
    throw new GitHubCliError(
      `Failed to execute gh CLI (unexpected error type):\n` +
        `Command: gh ${args.join(' ')}\n` +
        `Error type: ${errorType}\n` +
        `Error value: ${errorStr}\n` +
        `Error serialized: ${errorSerialized}\n` +
        `This indicates a programming error (non-Error thrown).\n` +
        `Stack trace at catch point:\n${capturedStack}`
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
    // TODO(#441): Fix silent error swallowing in getCurrentRepo()
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
      // WARN level - malformed lines represent data loss that affects failure diagnosis
      console.error(
        `[gh-workflow] WARN Skipping malformed log line - missing first tab delimiter (linePreview: ${line.substring(0, 100)}, lineLength: ${line.length}, impact: Failure diagnosis may be incomplete)`
      );
      continue;
    }

    const secondTab = line.indexOf('\t', firstTab + 1);
    if (secondTab === -1) {
      skippedCount++;
      // WARN level - malformed lines represent data loss that affects failure diagnosis
      console.error(
        `[gh-workflow] WARN Skipping malformed log line - missing second tab delimiter (linePreview: ${line.substring(0, 100)}, lineLength: ${line.length}, impact: Failure diagnosis may be incomplete)`
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
        `  3. Non-standard workflow step output (custom actions, binary data)`,
      undefined,
      {
        totalLines,
        skippedLines: skippedCount,
        successRate,
        minSuccessRate: MIN_SUCCESS_RATE,
        parsedSteps: steps.size,
        parsedLines: successCount,
        parseType: 'workflow-logs',
      }
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
 *
 * Re-exports from mcp-common for backward compatibility.
 */
export const sleep = sharedSleep;

/**
 * Execute gh CLI command with retry logic
 *
 * Retries gh CLI commands for transient errors (network issues, timeouts, 5xx errors, rate limits).
 * Uses exponential backoff (2s, 4s, 8s). Logs retry attempts and final failures.
 * Non-retryable errors (like validation errors) fail immediately.
 *
 * This is a wrapper around the shared ghCliWithRetry from mcp-common,
 * injecting the local ghCli function.
 */
export async function ghCliWithRetry(
  args: string[],
  options?: GhCliOptions,
  maxRetries = 3
): Promise<string> {
  return sharedGhCliWithRetry(ghCli, args, options as GhCliWithRetryOptions, maxRetries);
}
