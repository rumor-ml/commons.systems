/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from "execa";
import { GitHubCliError } from "./errors.js";
import { PR_CHECK_IN_PROGRESS_STATES, PR_CHECK_TERMINAL_STATE_MAP } from "../constants.js";

export interface GhCliOptions {
  repo?: string;
  timeout?: number;
}

/**
 * Execute a GitHub CLI command safely with proper error handling
 */
export async function ghCli(
  args: string[],
  options: GhCliOptions = {}
): Promise<string> {
  try {
    const execaOptions: any = {
      timeout: options.timeout,
      reject: false,
    };

    // Add repo flag if provided
    const fullArgs = options.repo ? ["--repo", options.repo, ...args] : args;

    const result = await execa("gh", fullArgs, execaOptions);

    if (result.exitCode !== 0) {
      throw new GitHubCliError(
        `GitHub CLI command failed: ${result.stderr || result.stdout}`,
        result.exitCode,
        result.stderr || undefined
      );
    }

    return result.stdout || "";
  } catch (error) {
    if (error instanceof GitHubCliError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new GitHubCliError(`Failed to execute gh CLI: ${error.message}`);
    }
    throw new GitHubCliError(`Failed to execute gh CLI: ${String(error)}`);
  }
}

/**
 * Execute a GitHub CLI command and parse JSON output
 */
export async function ghCliJson<T>(
  args: string[],
  options: GhCliOptions = {}
): Promise<T> {
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
 */
export async function getCurrentRepo(): Promise<string> {
  try {
    const result = await ghCli(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
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
    ["run", "view", runId.toString(), "--json", "databaseId,name,status,conclusion,url,createdAt,updatedAt,workflowName"],
    { repo: resolvedRepo }
  );
}

/**
 * Get workflow runs for a branch
 */
export async function getWorkflowRunsForBranch(branch: string, repo?: string, limit = 1): Promise<any[]> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson<any[]>(
    [
      "run", "list",
      "--branch", branch,
      "--limit", limit.toString(),
      "--json", "databaseId,name,status,conclusion,url,createdAt,updatedAt,workflowName"
    ],
    { repo: resolvedRepo }
  );
}

/**
 * Map PR check state to workflow run status
 *
 * GitHub's `gh pr checks` API returns check states (PENDING, QUEUED, IN_PROGRESS, WAITING, SUCCESS, FAILURE, etc.)
 * that differ from workflow run statuses (in_progress, completed). This mapping normalizes PR check states
 * to the workflow run status format used by the monitoring tools.
 *
 * Mapping rationale:
 * - PENDING/QUEUED/IN_PROGRESS/WAITING → "in_progress": All represent actively running or queued checks
 * - All other states (SUCCESS, FAILURE, ERROR, CANCELLED, SKIPPED, STALE) → "completed": Terminal states
 *
 * Source: GitHub CLI `gh pr checks` command returns CheckRun states from the GitHub API
 * Possible values: PENDING, QUEUED, IN_PROGRESS, WAITING, SUCCESS, FAILURE, ERROR, CANCELLED, SKIPPED, STALE
 *
 * @param state - The PR check state from GitHub API (uppercase format)
 * @returns Normalized workflow run status ("in_progress" or "completed")
 */
export function mapStateToStatus(state: string): string {
  return PR_CHECK_IN_PROGRESS_STATES.includes(state) ? "in_progress" : "completed";
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
      "pr", "checks", prNumber.toString(),
      "--json", "name,state,link,startedAt,completedAt,workflow"
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
  return ghCliJson(
    [
      "pr", "view", prNumber.toString(),
      "--json", "number,title,state,url,headRefName,headRefOid,baseRefName"
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
  _runId: number,  // Unused - kept for API compatibility
  jobId: number,
  repo?: string,
  tailLines = 2000
): Promise<string> {
  const resolvedRepo = await resolveRepo(repo);

  // Use GitHub API directly - this allows fetching logs for completed jobs
  // even when the overall workflow run is still in progress.
  // The `gh run view --log` command blocks until the entire run completes.
  const fullLogs = await ghCliWithRetry(
    ["api", `repos/${resolvedRepo}/actions/jobs/${jobId}/logs`],
    {}  // No repo flag needed - it's in the API path
  );

  const lines = fullLogs.split("\n");
  if (lines.length > tailLines) {
    const truncatedCount = lines.length - tailLines;
    return `... (${truncatedCount} lines truncated)\n` + lines.slice(-tailLines).join("\n");
  }
  return fullLogs;
}

/**
 * Get all jobs for a workflow run
 */
export async function getWorkflowJobs(runId: number, repo?: string) {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson(
    [
      "run", "view", runId.toString(),
      "--json", "jobs"
    ],
    { repo: resolvedRepo }
  );
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (network errors, 5xx server errors)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("socket") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504")
    );
  }
  return false;
}

/**
 * Execute gh CLI command with retry logic
 */
export async function ghCliWithRetry(
  args: string[],
  options?: GhCliOptions,
  maxRetries = 3
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await ghCli(args, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryableError(error) || attempt === maxRetries) {
        throw lastError;
      }

      // Exponential backoff: 2s, 4s, 8s
      const delayMs = Math.pow(2, attempt) * 1000;
      await sleep(delayMs);
    }
  }

  throw lastError || new Error("Unexpected retry failure");
}
