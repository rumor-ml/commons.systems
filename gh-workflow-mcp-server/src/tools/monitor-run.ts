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
    max_single_call_timeout_seconds: z
      .number()
      .int()
      .positive()
      .max(60)
      .optional()
      .describe(
        'Max duration for a single monitoring call. If workflow not complete, returns "still running" for caller to retry. Used by wiggum to avoid MCP SDK 60s timeout.'
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
    const startTime = Date.now();

    // Calculate effective timeout
    let effectiveTimeout = input.timeout_seconds * 1000;

    // If max_single_call_timeout specified, cap the timeout
    if (input.max_single_call_timeout_seconds) {
      effectiveTimeout = Math.min(effectiveTimeout, input.max_single_call_timeout_seconds * 1000);
    }

    const timeoutMs = effectiveTimeout;

    let runIds: number[];
    let monitoringMultipleRuns = false;

    // Resolve run_id from pr_number or branch if needed
    if (input.run_id) {
      runIds = [input.run_id];
    } else if (input.pr_number) {
      const checksResult = await getWorkflowRunsForPR(input.pr_number, resolvedRepo);
      const checks = checksResult.runs;
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

    // Single run: Use native watch (includes fail-fast via --exit-status)
    if (!monitoringMultipleRuns) {
      const watchResult = await watchWorkflowRun(runIds[0], {
        timeout: timeoutMs,
        repo: resolvedRepo,
      });

      // If timed out AND using chunked mode, return "still running"
      if (watchResult.timedOut && input.max_single_call_timeout_seconds) {
        return {
          content: [
            {
              type: 'text',
              text: 'WORKFLOW_RUNNING: Workflow still in progress. Monitoring will continue automatically.',
            },
          ],
        };
      }

      // If timed out WITHOUT chunked mode, throw timeout error (original behavior)
      if (watchResult.timedOut) {
        throw new TimeoutError(
          `Workflow run did not complete within ${input.timeout_seconds} seconds`
        );
      }
    }
    // Multiple runs: Watch all in parallel
    else {
      const watchPromises = runIds.map((id) =>
        watchWorkflowRun(id, { timeout: timeoutMs, repo: resolvedRepo })
      );

      const results = await Promise.allSettled(watchPromises);

      // Check if any watch timed out
      const timedOut = results.some(
        (result) => result.status === 'fulfilled' && result.value.timedOut
      );

      // If timed out AND using chunked mode, return "still running"
      if (timedOut && input.max_single_call_timeout_seconds) {
        return {
          content: [
            {
              type: 'text',
              text: 'WORKFLOW_RUNNING: Workflow still in progress. Monitoring will continue automatically.',
            },
          ],
        };
      }

      // If timed out WITHOUT chunked mode, throw timeout error (original behavior)
      if (timedOut) {
        throw new TimeoutError(
          `Workflow runs did not complete within ${input.timeout_seconds} seconds`
        );
      }
    }

    // After watch completes, fetch structured data
    const fetchedRuns = await Promise.all(runIds.map((id) => getWorkflowRun(id, resolvedRepo)));
    const runs: Map<number, WorkflowRunData> = new Map();
    fetchedRuns.forEach((runData, index) => {
      // SAFETY: gh CLI returns JSON matching WorkflowRunData structure (see #539 for planned schema validation)
      runs.set(runIds[index], runData as WorkflowRunData);
    });

    const jobsResults = await Promise.all(runIds.map((id) => getWorkflowJobs(id, resolvedRepo)));
    const allJobs: Map<number, JobData[]> = new Map();
    jobsResults.forEach((jobsData: any, index) => {
      // SAFETY: gh CLI returns JSON matching JobData[] structure (see #539 for planned schema validation)
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
