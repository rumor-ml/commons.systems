/**
 * Tool: gh_monitor_run
 * Monitor a GitHub Actions workflow run until completion
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_TIMEOUT,
  MIN_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  MAX_TIMEOUT,
  FAILURE_CONCLUSIONS,
} from '../constants.js';
import {
  getWorkflowRun,
  getWorkflowRunsForPR,
  getBranchHeadSha,
  getWorkflowRunsForCommit,
  resolveRepo,
  sleep,
  getWorkflowJobs,
} from '../utils/gh-cli.js';
import { TimeoutError, ValidationError, createErrorResult } from '../utils/errors.js';
import { watchWorkflowRun } from '../utils/gh-watch.js';

export const MonitorRunInputSchema = z
  .object({
    run_id: z.number().int().positive().optional(),
    pr_number: z.number().int().positive().optional(),
    branch: z.string().optional(),
    repo: z.string().optional(),
    poll_interval_seconds: z
      .number()
      .int()
      .min(MIN_POLL_INTERVAL)
      .max(MAX_POLL_INTERVAL)
      .default(DEFAULT_POLL_INTERVAL),
    timeout_seconds: z.number().int().positive().max(MAX_TIMEOUT).default(DEFAULT_TIMEOUT),
    fail_fast: z
      .boolean()
      .default(true)
      .describe(
        'Exit immediately on first failure detection. Set to false to wait for all checks to complete.'
      ),
  })
  .strict();

export type MonitorRunInput = z.infer<typeof MonitorRunInputSchema>;

interface WorkflowRunData {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  workflowName: string;
  headSha?: string;
}

interface JobData {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  startedAt: string;
  completedAt?: string;
}

/**
 * Poll jobs for failure detection while watching runs
 *
 * Used for fail-fast mode: polls job status in parallel with watch
 * to detect failures quickly without waiting for watch to complete.
 * Returns immediately when first failure detected, enabling early
 * termination of the watching race condition.
 *
 * @param runIds - Single run ID or array of run IDs to poll
 * @param pollIntervalMs - Milliseconds between polls
 * @param timeoutMs - Maximum time to poll
 * @param repo - Repository in format "owner/repo"
 */
async function pollJobsForFailure(
  runIds: number | number[],
  pollIntervalMs: number,
  timeoutMs: number,
  repo: string
): Promise<void> {
  const ids = Array.isArray(runIds) ? runIds : [runIds];
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const jobsResults = await Promise.all(ids.map((id) => getWorkflowJobs(id, repo)));

      for (const jobsData of jobsResults) {
        // TODO: See issue #539 - Add runtime validation for gh CLI response structure
        const jobs = (jobsData as any).jobs || [];
        const failedJob = jobs.find(
          (job: JobData) => job.conclusion && FAILURE_CONCLUSIONS.includes(job.conclusion)
        );
        if (failedJob) {
          return; // Exit early on failure
        }
      }
    } catch (error) {
      // Log error but continue polling - fail-fast is an optimization, not critical
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(
        `[gh-workflow] pollJobsForFailure: error fetching jobs (runIds: ${ids.join(',')}, error: ${errorMsg}), continuing polling`
      );
    }

    await sleep(pollIntervalMs);
  }
}

/**
 * Monitor a GitHub Actions workflow run until completion or failure
 *
 * Supports monitoring by run_id, pr_number, or branch name. Can monitor multiple
 * concurrent runs when using branch-based monitoring. Provides fail-fast detection
 * to exit early on first job failure.
 *
 * @param input - Monitor configuration
 * @param input.run_id - Specific workflow run ID to monitor
 * @param input.pr_number - PR number (monitors most recent run)
 * @param input.branch - Branch name (monitors all runs for HEAD commit)
 * @param input.repo - Repository in format "owner/repo" (defaults to current)
 * @param input.poll_interval_seconds - Polling frequency (default: 10s)
 * @param input.timeout_seconds - Maximum wait time (default: 600s)
 * @param input.fail_fast - Exit on first failure (default: true)
 *
 * @returns Structured summary with run status, duration, and job details
 *
 * @throws {ValidationError} If no identifier provided or run not found
 * @throws {TimeoutError} If run doesn't complete within timeout
 * @throws {GitHubCliError} If gh CLI command fails (exit code != 0)
 * @throws {ParsingError} If JSON output from gh CLI is malformed
 *
 * @example
 * // Monitor specific run with fail-fast
 * await monitorRun({ run_id: 123456, fail_fast: true });
 *
 * @example
 * // Monitor all runs for branch (waits for all to complete)
 * await monitorRun({ branch: "feature-123", fail_fast: false });
 */
export async function monitorRun(input: MonitorRunInput): Promise<ToolResult> {
  try {
    // Validate input - must have exactly one of run_id, pr_number, or branch
    const identifierCount = [input.run_id, input.pr_number, input.branch].filter(
      (x) => x !== undefined
    ).length;

    if (identifierCount === 0) {
      throw new ValidationError('Must provide at least one of: run_id, pr_number, or branch');
    }

    const resolvedRepo = await resolveRepo(input.repo);
    const pollIntervalMs = input.poll_interval_seconds * 1000;
    const timeoutMs = input.timeout_seconds * 1000;
    const startTime = Date.now();

    let runIds: number[];
    let monitoringMultipleRuns = false;

    // Resolve run_id from pr_number or branch if needed
    if (input.run_id) {
      runIds = [input.run_id];
    } else if (input.pr_number) {
      const checks = await getWorkflowRunsForPR(input.pr_number, resolvedRepo);
      if (!Array.isArray(checks) || checks.length === 0) {
        throw new ValidationError(`No workflow runs found for PR #${input.pr_number}`);
      }
      // Get the most recent run - we'll need to extract run ID from the detailsUrl
      const firstCheck = checks[0];
      const runIdMatch = firstCheck.detailsUrl?.match(/\/runs\/(\d+)/);
      if (!runIdMatch) {
        throw new ValidationError(`Could not extract run ID from PR #${input.pr_number} checks`);
      }
      runIds = [parseInt(runIdMatch[1], 10)];
    } else if (input.branch) {
      // Get the HEAD commit SHA for the branch
      const headSha = await getBranchHeadSha(input.branch, resolvedRepo);
      if (!headSha) {
        throw new ValidationError(`Could not determine head SHA for branch ${input.branch}`);
      }

      // Get all workflow runs for this commit (catches all trigger events including "dynamic")
      const runs = await getWorkflowRunsForCommit(headSha, resolvedRepo, 20);
      if (!Array.isArray(runs) || runs.length === 0) {
        throw new ValidationError(
          `No workflow runs found for branch ${input.branch} (commit ${headSha})`
        );
      }

      runIds = runs.map((r) => r.databaseId);
      monitoringMultipleRuns = runIds.length > 1;
    } else {
      throw new ValidationError('Must provide at least one of: run_id, pr_number, or branch');
    }

    // Use watch for completion detection
    let failedEarly = false;
    let failedRunId: number | null = null;

    // Single run: Use watch + JSON query
    if (!monitoringMultipleRuns) {
      if (input.fail_fast) {
        // Hybrid: Race between watch and job polling for fail-fast
        const watchPromise = watchWorkflowRun(runIds[0], {
          timeout: timeoutMs,
          repo: resolvedRepo,
        });
        const failFastPromise = pollJobsForFailure(
          runIds[0],
          pollIntervalMs,
          timeoutMs,
          resolvedRepo
        );

        await Promise.race([watchPromise, failFastPromise]);
      } else {
        // Simple watch until completion
        const watchResult = await watchWorkflowRun(runIds[0], {
          timeout: timeoutMs,
          repo: resolvedRepo,
        });

        if (watchResult.timedOut) {
          throw new TimeoutError(
            `Workflow run did not complete within ${input.timeout_seconds} seconds`
          );
        }
      }
    }
    // Multiple runs: Watch all in parallel
    else {
      const watchPromises = runIds.map((id) =>
        watchWorkflowRun(id, { timeout: timeoutMs, repo: resolvedRepo })
      );

      if (input.fail_fast) {
        const failFastPromise = pollJobsForFailure(runIds, pollIntervalMs, timeoutMs, resolvedRepo);
        await Promise.race([Promise.allSettled(watchPromises), failFastPromise]);
      } else {
        const results = await Promise.allSettled(watchPromises);

        // Check if any watch timed out
        const timedOut = results.some(
          (result) => result.status === 'fulfilled' && result.value.timedOut
        );
        if (timedOut) {
          throw new TimeoutError(
            `Workflow runs did not complete within ${input.timeout_seconds} seconds`
          );
        }
      }
    }

    // After watch completes, fetch structured data
    const fetchedRuns = await Promise.all(runIds.map((id) => getWorkflowRun(id, resolvedRepo)));
    const runs: Map<number, WorkflowRunData> = new Map();
    fetchedRuns.forEach((runData, index) => {
      // TODO: See issue #539 - Add runtime validation for gh CLI response structure
      runs.set(runIds[index], runData as WorkflowRunData);
    });

    const jobsResults = await Promise.all(runIds.map((id) => getWorkflowJobs(id, resolvedRepo)));
    const allJobs: Map<number, JobData[]> = new Map();
    jobsResults.forEach((jobsData: any, index) => {
      // TODO: See issue #539 - Add runtime validation for gh CLI response structure
      allJobs.set(runIds[index], jobsData.jobs || []);
    });

    // Check for fail-fast condition to set failedEarly flag
    if (input.fail_fast) {
      for (const [runId, jobs] of allJobs) {
        const failedJob = jobs.find(
          (job) => job.conclusion && FAILURE_CONCLUSIONS.includes(job.conclusion)
        );

        if (failedJob) {
          failedEarly = true;
          failedRunId = runId;
          break;
        }
      }
    }

    // Format output for multiple or single runs
    const summaryLines: string[] = [];
    const totalDurationSeconds = Math.round((Date.now() - startTime) / 1000);

    if (monitoringMultipleRuns) {
      // Multi-run output format
      const headerSuffix = failedEarly ? ' (early exit)' : '';
      const monitoringSuffix = failedEarly ? ' (fail-fast enabled)' : '';

      summaryLines.push(
        `Workflow Runs ${failedEarly ? 'Failed' : 'Completed'}${headerSuffix} (${runs.size} concurrent runs)`
      );
      summaryLines.push('');

      // Show each run with its jobs
      for (const [runId, run] of runs) {
        const jobs = allJobs.get(runId) || [];
        const startedAt = new Date(run.createdAt);
        const completedAt = new Date(run.updatedAt);
        const durationSeconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);

        const failureMarker = failedEarly && runId === failedRunId ? ' ⚠️ FAILED' : '';
        summaryLines.push(`Run: ${run.workflowName || run.name}${failureMarker}`);
        summaryLines.push(`  Status: ${run.status}`);
        summaryLines.push(`  Conclusion: ${run.conclusion || 'none'}`);
        summaryLines.push(`  Duration: ${durationSeconds}s`);
        summaryLines.push(`  URL: ${run.url}`);
        summaryLines.push(`  Jobs (${jobs.length}):`);

        jobs.forEach((job) => {
          const jobDuration = job.completedAt
            ? Math.round(
                (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000
              )
            : null;
          summaryLines.push(
            `    - ${job.name}: ${job.conclusion || job.status}${jobDuration ? ` (${jobDuration}s)` : ''}`
          );
        });
        summaryLines.push('');
      }

      summaryLines.push(`Monitoring completed in ${totalDurationSeconds}s${monitoringSuffix}`);
    } else {
      // Single-run output format (backward compatible)
      const run = runs.get(runIds[0])!;
      const jobs = allJobs.get(runIds[0]) || [];
      const startedAt = new Date(run.createdAt);
      const completedAt = new Date(run.updatedAt);
      const durationSeconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);

      const jobSummaries = jobs.map((job) => {
        const jobDuration = job.completedAt
          ? Math.round(
              (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000
            )
          : null;
        return `  - ${job.name}: ${job.conclusion || job.status}${jobDuration ? ` (${jobDuration}s)` : ''}`;
      });

      const headerSuffix = failedEarly ? ' (early exit)' : '';
      const monitoringSuffix = failedEarly ? ' (fail-fast enabled)' : '';

      summaryLines.push(
        `Workflow Run ${failedEarly ? 'Failed' : 'Completed'}${headerSuffix}: ${run.workflowName || run.name}`
      );
      summaryLines.push(`Status: ${run.status}`);
      summaryLines.push(`Conclusion: ${run.conclusion || 'none'}`);
      summaryLines.push(`Duration: ${durationSeconds}s`);
      summaryLines.push(`URL: ${run.url}`);
      summaryLines.push('');
      summaryLines.push(`Jobs (${jobs.length}):`);
      summaryLines.push(...jobSummaries);
      summaryLines.push('');
      summaryLines.push(`Monitoring completed in ${totalDurationSeconds}s${monitoringSuffix}`);
    }

    return {
      content: [{ type: 'text', text: summaryLines.join('\n') }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
