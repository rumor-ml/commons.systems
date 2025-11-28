/**
 * GitHub CLI wrapper utilities for safe command execution
 */

import { execa } from "execa";
import { GitHubCliError } from "./errors.js";

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
 * Get workflow runs for a PR
 */
export async function getWorkflowRunsForPR(prNumber: number, repo?: string): Promise<any[]> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCliJson<any[]>(
    [
      "pr", "checks", prNumber.toString(),
      "--json", "name,status,conclusion,detailsUrl,startedAt,completedAt"
    ],
    { repo: resolvedRepo }
  );
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
 * Get workflow job logs
 */
export async function getJobLogs(runId: number, jobId: number, repo?: string): Promise<string> {
  const resolvedRepo = await resolveRepo(repo);
  return ghCli(
    ["run", "view", "--job", jobId.toString(), "--log", runId.toString()],
    { repo: resolvedRepo }
  );
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
