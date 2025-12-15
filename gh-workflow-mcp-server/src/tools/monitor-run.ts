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
  ghCli,
} from '../utils/gh-cli.js';
import { TimeoutError, ValidationError, createErrorResult } from '../utils/errors.js';

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

    // Watch each run until completion using gh run watch
    const runs: Map<number, WorkflowRunData> = new Map();
    const allJobs: Map<number, JobData[]> = new Map();
    let failedEarly = false;
    let failedRunId: number | null = null;

    for (const runId of runIds) {
      const remainingTimeout = timeoutMs - (Date.now() - startTime);

      if (remainingTimeout <= 0) {
        throw new TimeoutError(
          `Workflow runs did not complete within ${input.timeout_seconds} seconds`
        );
      }

      // Use gh run watch to wait for completion
      // Exit code 0 = success, non-zero = failure (but we continue to fetch details)
      let watchFailed = false;
      // @ts-expect-error - Preserved for potential future debugging use
      let watchError: Error | undefined;
      try {
        await ghCli(
          [
            'run',
            'watch',
            runId.toString(),
            '--exit-status',
            '-i',
            input.poll_interval_seconds.toString(),
          ],
          { repo: resolvedRepo, timeout: remainingTimeout }
        );
      } catch (error) {
        // Watch command failed - could be workflow failure or timeout
        // We'll fetch the final status to determine what happened
        watchFailed = true;
        watchError = error instanceof Error ? error : new Error(String(error));
        // Note: We continue to fetch final status - watchError preserved for context if needed
      }

      // Fetch final status with JSON
      const runData = (await getWorkflowRun(runId, resolvedRepo)) as WorkflowRunData;
      runs.set(runId, runData);

      const jobsData: any = await getWorkflowJobs(runId, resolvedRepo);
      const jobs = (jobsData.jobs || []) as JobData[];
      allJobs.set(runId, jobs);

      // Check for fail-fast condition
      if (input.fail_fast && watchFailed) {
        // Check if any job actually failed (not just timeout)
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

    if (monitoringMultipleRuns) {
      // Multi-run output format
      const headerSuffix = failedEarly ? ' (early exit)' : '';
      const monitoringSuffix = failedEarly ? ' (fail-fast enabled)' : '';

      summaryLines.push(
        `Workflow Runs ${failedEarly ? 'Failed' : 'Completed'}${headerSuffix} (${runs.size} concurrent runs)`
      );
      summaryLines.push('');

      // Show each run with its jobs
      for (const [runId, run] of runs.entries()) {
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

      summaryLines.push(
        `Monitoring completed over ${Math.round((Date.now() - startTime) / 1000)}s${monitoringSuffix}`
      );
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
      summaryLines.push(
        `Monitoring completed over ${Math.round((Date.now() - startTime) / 1000)}s${monitoringSuffix}`
      );
    }

    return {
      content: [{ type: 'text', text: summaryLines.join('\n') }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
