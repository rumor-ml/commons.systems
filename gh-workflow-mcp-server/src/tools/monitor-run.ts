/**
 * Tool: gh_monitor_run
 * Monitor a GitHub Actions workflow run until completion
 */

import { z } from "zod";
import type { ToolResult } from "../types.js";
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_TIMEOUT,
  MIN_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  MAX_TIMEOUT,
  COMPLETED_STATUSES,
  FAILURE_CONCLUSIONS,
} from "../constants.js";
import {
  getWorkflowRun,
  getWorkflowRunsForBranch,
  getWorkflowRunsForPR,
  resolveRepo,
  sleep,
  getWorkflowJobs,
} from "../utils/gh-cli.js";
import { TimeoutError, ValidationError, createErrorResult } from "../utils/errors.js";

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
    timeout_seconds: z
      .number()
      .int()
      .positive()
      .max(MAX_TIMEOUT)
      .default(DEFAULT_TIMEOUT),
    fail_fast: z
      .boolean()
      .default(true)
      .describe("Exit immediately on first failure detection. Set to false to wait for all checks to complete."),
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
      throw new ValidationError(
        "Must provide at least one of: run_id, pr_number, or branch"
      );
    }

    const resolvedRepo = await resolveRepo(input.repo);
    const pollIntervalMs = input.poll_interval_seconds * 1000;
    const timeoutMs = input.timeout_seconds * 1000;
    const startTime = Date.now();

    let runId: number;

    // Resolve run_id from pr_number or branch if needed
    if (input.run_id) {
      runId = input.run_id;
    } else if (input.pr_number) {
      const checks = await getWorkflowRunsForPR(input.pr_number, resolvedRepo);
      if (!Array.isArray(checks) || checks.length === 0) {
        throw new ValidationError(
          `No workflow runs found for PR #${input.pr_number}`
        );
      }
      // Get the most recent run - we'll need to extract run ID from the detailsUrl
      const firstCheck = checks[0];
      const runIdMatch = firstCheck.detailsUrl?.match(/\/runs\/(\d+)/);
      if (!runIdMatch) {
        throw new ValidationError(
          `Could not extract run ID from PR #${input.pr_number} checks`
        );
      }
      runId = parseInt(runIdMatch[1], 10);
    } else if (input.branch) {
      const runs = await getWorkflowRunsForBranch(input.branch, resolvedRepo, 1);
      if (!Array.isArray(runs) || runs.length === 0) {
        throw new ValidationError(
          `No workflow runs found for branch ${input.branch}`
        );
      }
      runId = runs[0].databaseId;
    } else {
      throw new ValidationError(
        "Must provide at least one of: run_id, pr_number, or branch"
      );
    }

    // Poll until completion or timeout
    let run: WorkflowRunData | null = null;
    let iterationCount = 0;
    let failedEarly = false;
    let jobs: JobData[] = [];

    while (Date.now() - startTime < timeoutMs) {
      iterationCount++;
      run = (await getWorkflowRun(runId, resolvedRepo)) as WorkflowRunData;

      if (COMPLETED_STATUSES.includes(run.status)) {
        break;
      }

      // Check for fail-fast condition
      if (input.fail_fast) {
        const jobsData = (await getWorkflowJobs(runId, resolvedRepo)) as { jobs: JobData[] };
        jobs = jobsData.jobs || [];

        const failedJob = jobs.find(
          (job) => job.conclusion && FAILURE_CONCLUSIONS.includes(job.conclusion)
        );

        if (failedJob) {
          failedEarly = true;
          break;
        }
      }

      await sleep(pollIntervalMs);
    }

    if (!run || (!COMPLETED_STATUSES.includes(run.status) && !failedEarly)) {
      throw new TimeoutError(
        `Workflow run did not complete within ${input.timeout_seconds} seconds`
      );
    }

    // Get job details if not already fetched
    if (jobs.length === 0) {
      const jobsData = (await getWorkflowJobs(runId, resolvedRepo)) as { jobs: JobData[] };
      jobs = jobsData.jobs || [];
    }

    // Calculate duration
    const startedAt = new Date(run.createdAt);
    const completedAt = new Date(run.updatedAt);
    const durationSeconds = Math.round(
      (completedAt.getTime() - startedAt.getTime()) / 1000
    );

    // Format job summaries
    const jobSummaries = jobs.map((job) => {
      const jobDuration = job.completedAt
        ? Math.round(
            (new Date(job.completedAt).getTime() -
              new Date(job.startedAt).getTime()) /
              1000
          )
        : null;
      return `  - ${job.name}: ${job.conclusion || job.status}${jobDuration ? ` (${jobDuration}s)` : ""}`;
    });

    const headerSuffix = failedEarly ? " (early exit)" : "";
    const monitoringSuffix = failedEarly ? " (fail-fast enabled)" : "";

    const summary = [
      `Workflow Run ${failedEarly ? "Failed" : "Completed"}${headerSuffix}: ${run.workflowName || run.name}`,
      `Status: ${run.status}`,
      `Conclusion: ${run.conclusion || "none"}`,
      `Duration: ${durationSeconds}s`,
      `URL: ${run.url}`,
      ``,
      `Jobs (${jobs.length}):`,
      ...jobSummaries,
      ``,
      `Monitoring completed after ${iterationCount} checks over ${Math.round((Date.now() - startTime) / 1000)}s${monitoringSuffix}`,
    ].join("\n");

    return {
      content: [{ type: "text", text: summary }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
