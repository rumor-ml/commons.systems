/**
 * Tool: gh_get_failure_details
 * Get token-efficient summary of workflow failures
 */

import { z } from "zod";
import type { ToolResult } from "../types.js";
import { MAX_RESPONSE_LENGTH, FAILURE_PATTERNS } from "../constants.js";
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
  test_summary?: string | null;
}

interface FailedJobSummary {
  name: string;
  url: string;
  conclusion: string | null;
  failed_steps: FailedStepSummary[];
}

/**
 * Extract test summary from logs (e.g., "1 failed, 77 passed")
 * Playwright outputs these on separate lines, so we need to find and combine them
 */
function extractTestSummary(logText: string): string | null {
  const lines = logText.split("\n");

  // Patterns for individual summary lines
  const failedPattern = /(\d+)\s+failed/i;
  const passedPattern = /(\d+)\s+passed/i;

  let failed: string | null = null;
  let passed: string | null = null;

  // Search from end for the most recent summary lines
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // Check for combined format first (e.g., "77 passed, 1 failed")
    if (failedPattern.test(line) && passedPattern.test(line)) {
      const failMatch = line.match(failedPattern);
      const passMatch = line.match(passedPattern);
      if (failMatch && passMatch) {
        return `${failMatch[1]} failed, ${passMatch[1]} passed`;
      }
    }

    // Otherwise collect separate lines
    if (!failed && failedPattern.test(line)) {
      const match = line.match(failedPattern);
      if (match) failed = match[1];
    }
    if (!passed && passedPattern.test(line)) {
      const match = line.match(passedPattern);
      if (match) passed = match[1];
    }

    // If we have both, return combined summary
    if (failed && passed) {
      return `${failed} failed, ${passed} passed`;
    }
  }

  // Return partial if we only found one
  if (failed) return `${failed} failed`;
  if (passed) return `${passed} passed`;

  return null;
}

/**
 * Extract error lines from logs, capturing ALL failure instances
 * with surrounding context
 */
function extractErrorLines(logText: string, maxLines = 40): string[] {
  const lines = logText.split("\n");
  const failureLineIndices: number[] = [];

  // First pass: find ALL lines matching failure patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isFailureLine = FAILURE_PATTERNS.some((pattern) => pattern.test(line));
    if (isFailureLine) {
      failureLineIndices.push(i);
    }
  }

  // No failures found
  if (failureLineIndices.length === 0) {
    return [];
  }

  // Second pass: collect unique lines with context around each failure
  const seenIndices = new Set<number>();
  const result: string[] = [];

  for (const failureIdx of failureLineIndices) {
    // Capture context: 2 lines before, 3 lines after
    const contextStart = Math.max(0, failureIdx - 2);
    const contextEnd = Math.min(lines.length, failureIdx + 4);

    for (let j = contextStart; j < contextEnd; j++) {
      if (!seenIndices.has(j)) {
        seenIndices.add(j);
        const line = lines[j].trim();
        if (line) {
          result.push(lines[j]); // Keep original formatting (not trimmed)
        }
      }
    }

    // Stop if we've collected enough
    if (result.length >= maxLines) {
      break;
    }
  }

  return result.slice(0, maxLines);
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

    // Get all jobs first - we need to check for failed jobs even if run is still in progress
    // (supports fail-fast monitoring where we detect failures before run completes)
    const jobsData = (await getWorkflowJobs(runId, resolvedRepo)) as { jobs: JobData[] };
    const jobs = jobsData.jobs || [];

    // Filter to failed jobs
    const failedJobs = jobs.filter(
      (job) => job.conclusion === "failure" || job.conclusion === "timed_out"
    );

    // Check if run failed OR if any jobs have failed (for fail-fast support)
    const runFailed = run.conclusion === "failure" || run.conclusion === "timed_out";
    const hasFailedJobs = failedJobs.length > 0;

    if (!runFailed && !hasFailedJobs) {
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
        const testSummary = extractTestSummary(logs);

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
              test_summary: testSummary,
            });

            totalChars += stepName.length + errorLines.join("\n").length;
            if (testSummary) totalChars += testSummary.length;
            if (totalChars > input.max_chars) break;
          }
        } else {
          // No step info, just extract general errors
          const errorLines = extractErrorLines(logs, 15);
          failedSteps.push({
            name: "General failure",
            conclusion: job.conclusion,
            error_lines: errorLines,
            test_summary: testSummary,
          });
          totalChars += errorLines.join("\n").length;
          if (testSummary) totalChars += testSummary.length;
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
        const parts: string[] = [];

        // Add test summary if available
        if (step.test_summary) {
          parts.push(`    Test Summary: ${step.test_summary}`);
        }

        // Add step name and conclusion
        parts.push(`    Step: ${step.name} (${step.conclusion})`);

        // Add error lines
        if (step.error_lines.length > 0) {
          const errorPreview = step.error_lines.slice(0, 10).join("\n      ");
          parts.push(`      ${errorPreview}`);
        }

        return parts.join("\n");
      });

      return [
        ``,
        `  Job: ${job.name} (${job.conclusion})`,
        `  URL: ${job.url}`,
        ...stepSummaries,
      ].join("\n");
    });

    // Indicate if run is still in progress (fail-fast scenario)
    const headerSuffix = run.status !== "completed" ? " (run still in progress)" : "";
    const summary = [
      `Workflow Run Failed${headerSuffix}: ${run.name}`,
      `Overall Status: ${run.status} / ${run.conclusion || "none"}`,
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
