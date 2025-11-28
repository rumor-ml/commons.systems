/**
 * Tool: gh_get_failure_details
 * Get token-efficient summary of workflow failures
 */

import { z } from "zod";
import type { ToolResult } from "../types.js";
import { MAX_RESPONSE_LENGTH, ERROR_PATTERNS } from "../constants.js";
import {
  getWorkflowRun,
  getWorkflowRunsForBranch,
  getWorkflowRunsForPR,
  getWorkflowJobs,
  getJobLogs,
  resolveRepo,
} from "../utils/gh-cli.js";
import { ValidationError, createErrorResult } from "../utils/errors.js";

export const GetFailureDetailsInputSchema = z
  .object({
    run_id: z.number().int().positive().optional(),
    pr_number: z.number().int().positive().optional(),
    branch: z.string().optional(),
    repo: z.string().optional(),
    max_chars: z.number().int().positive().default(MAX_RESPONSE_LENGTH),
  })
  .strict();

export type GetFailureDetailsInput = z.infer<typeof GetFailureDetailsInputSchema>;

interface WorkflowRunData {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

interface JobData {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  steps?: StepData[];
}

interface StepData {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

interface FailedStepSummary {
  name: string;
  conclusion: string | null;
  error_lines: string[];
}

interface FailedJobSummary {
  name: string;
  url: string;
  conclusion: string | null;
  failed_steps: FailedStepSummary[];
}

function extractErrorLines(logText: string, maxLines = 20): string[] {
  const lines = logText.split("\n");
  const errorLines: string[] = [];

  for (let i = 0; i < lines.length && errorLines.length < maxLines; i++) {
    const line = lines[i];

    // Check if line matches error patterns
    const isErrorLine = ERROR_PATTERNS.some((pattern) => pattern.test(line));

    if (isErrorLine) {
      // Include some context around the error
      const contextStart = Math.max(0, i - 1);
      const contextEnd = Math.min(lines.length, i + 3);

      for (let j = contextStart; j < contextEnd && errorLines.length < maxLines; j++) {
        const contextLine = lines[j].trim();
        if (contextLine && !errorLines.includes(contextLine)) {
          errorLines.push(contextLine);
        }
      }
    }
  }

  return errorLines;
}

export async function getFailureDetails(
  input: GetFailureDetailsInput
): Promise<ToolResult> {
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

    // Get run details
    const run = (await getWorkflowRun(runId, resolvedRepo)) as WorkflowRunData;

    // Check if run actually failed
    if (run.conclusion !== "failure" && run.conclusion !== "timed_out") {
      return {
        content: [
          {
            type: "text",
            text: [
              `Workflow run did not fail: ${run.name}`,
              `Status: ${run.status}`,
              `Conclusion: ${run.conclusion || "none"}`,
              `URL: ${run.url}`,
            ].join("\n"),
          },
        ],
      };
    }

    // Get all jobs
    const jobsData = (await getWorkflowJobs(runId, resolvedRepo)) as { jobs: JobData[] };
    const jobs = jobsData.jobs || [];

    // Filter to failed jobs
    const failedJobs = jobs.filter(
      (job) => job.conclusion === "failure" || job.conclusion === "timed_out"
    );

    if (failedJobs.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: [
              `No failed jobs found in workflow run: ${run.name}`,
              `Overall conclusion: ${run.conclusion}`,
              `URL: ${run.url}`,
            ].join("\n"),
          },
        ],
      };
    }

    // Collect failure details for each failed job
    const failedJobSummaries: FailedJobSummary[] = [];
    let totalChars = 0;

    for (const job of failedJobs) {
      const failedSteps: FailedStepSummary[] = [];

      // Get job logs
      try {
        const logs = await getJobLogs(runId, job.databaseId, resolvedRepo);

        // Find failed steps (if step info is available)
        const failedStepNames = job.steps
          ?.filter(
            (step) => step.conclusion === "failure" || step.conclusion === "timed_out"
          )
          .map((step) => step.name) || [];

        if (failedStepNames.length > 0) {
          // Extract errors for each failed step
          for (const stepName of failedStepNames) {
            const errorLines = extractErrorLines(logs, 10);
            failedSteps.push({
              name: stepName,
              conclusion: "failure",
              error_lines: errorLines,
            });

            totalChars += stepName.length + errorLines.join("\n").length;
            if (totalChars > input.max_chars) break;
          }
        } else {
          // No step info, just extract general errors
          const errorLines = extractErrorLines(logs, 15);
          failedSteps.push({
            name: "General failure",
            conclusion: job.conclusion,
            error_lines: errorLines,
          });
          totalChars += errorLines.join("\n").length;
        }
      } catch (error) {
        // If we can't get logs, note that
        failedSteps.push({
          name: "Unable to retrieve logs",
          conclusion: job.conclusion,
          error_lines: [`Error retrieving logs: ${error}`],
        });
      }

      failedJobSummaries.push({
        name: job.name,
        url: job.url,
        conclusion: job.conclusion,
        failed_steps: failedSteps,
      });

      if (totalChars > input.max_chars) break;
    }

    // Format the summary
    const jobSummaries = failedJobSummaries.map((job) => {
      const stepSummaries = job.failed_steps.map((step) => {
        const errorPreview = step.error_lines.slice(0, 10).join("\n      ");
        return `    Step: ${step.name} (${step.conclusion})\n      ${errorPreview}`;
      });

      return [
        `  Job: ${job.name} (${job.conclusion})`,
        `  URL: ${job.url}`,
        ...stepSummaries,
      ].join("\n");
    });

    const summary = [
      `Workflow Run Failed: ${run.name}`,
      `Overall Status: ${run.status} / ${run.conclusion}`,
      `URL: ${run.url}`,
      ``,
      `Failed Jobs (${failedJobSummaries.length}):`,
      ...jobSummaries,
    ].join("\n");

    // Truncate if needed
    const finalSummary =
      summary.length > input.max_chars
        ? summary.substring(0, input.max_chars) +
          "\n\n... (truncated due to length limit)"
        : summary;

    return {
      content: [{ type: "text", text: finalSummary }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
