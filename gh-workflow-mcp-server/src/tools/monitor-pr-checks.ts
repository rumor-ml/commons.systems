/**
 * Tool: gh_monitor_pr_checks
 * Monitor all status checks for a pull request until completion
 */

import { z } from "zod";
import type { ToolResult } from "../types.js";
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_TIMEOUT,
  MIN_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  MAX_TIMEOUT,
  IN_PROGRESS_STATUSES,
} from "../constants.js";
import {
  getWorkflowRunsForPR,
  getPR,
  resolveRepo,
  sleep,
} from "../utils/gh-cli.js";
import { TimeoutError, ValidationError, createErrorResult } from "../utils/errors.js";

export const MonitorPRChecksInputSchema = z
  .object({
    pr_number: z.number().int().positive(),
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
  })
  .strict();

export type MonitorPRChecksInput = z.infer<typeof MonitorPRChecksInputSchema>;

interface CheckData {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
  startedAt: string;
  completedAt?: string;
}

interface PRData {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
}

export async function monitorPRChecks(
  input: MonitorPRChecksInput
): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);
    const pollIntervalMs = input.poll_interval_seconds * 1000;
    const timeoutMs = input.timeout_seconds * 1000;
    const startTime = Date.now();

    // Get PR details first
    const pr = (await getPR(input.pr_number, resolvedRepo)) as PRData;

    if (pr.state.toLowerCase() !== "open") {
      throw new ValidationError(
        `PR #${input.pr_number} is ${pr.state}, not open`
      );
    }

    // Poll until all checks complete or timeout
    let checks: CheckData[] = [];
    let iterationCount = 0;
    let allComplete = false;

    while (Date.now() - startTime < timeoutMs) {
      iterationCount++;
      checks = (await getWorkflowRunsForPR(
        input.pr_number,
        resolvedRepo
      )) as CheckData[];

      if (!checks || checks.length === 0) {
        // No checks yet, keep waiting
        await sleep(pollIntervalMs);
        continue;
      }

      // Check if all checks are complete
      allComplete = checks.every(
        (check) => !IN_PROGRESS_STATUSES.includes(check.status)
      );

      if (allComplete) {
        break;
      }

      await sleep(pollIntervalMs);
    }

    if (!allComplete) {
      throw new TimeoutError(
        `PR checks did not complete within ${input.timeout_seconds} seconds`
      );
    }

    // Summarize results
    const successCount = checks.filter((c) => c.conclusion === "success").length;
    const failureCount = checks.filter(
      (c) => c.conclusion === "failure" || c.conclusion === "timed_out"
    ).length;
    const otherCount = checks.length - successCount - failureCount;

    const checkSummaries = checks.map((check) => {
      const icon =
        check.conclusion === "success"
          ? "✓"
          : check.conclusion === "failure" || check.conclusion === "timed_out"
            ? "✗"
            : "○";
      return `  ${icon} ${check.name}: ${check.conclusion || check.status}`;
    });

    const overallStatus =
      failureCount > 0
        ? "FAILED"
        : successCount === checks.length
          ? "SUCCESS"
          : "MIXED";

    const summary = [
      `PR #${pr.number} Checks Completed: ${pr.title}`,
      `Overall Status: ${overallStatus}`,
      `Success: ${successCount}, Failed: ${failureCount}, Other: ${otherCount}`,
      `PR URL: ${pr.url}`,
      ``,
      `Checks (${checks.length}):`,
      ...checkSummaries,
      ``,
      `Monitoring completed after ${iterationCount} checks over ${Math.round((Date.now() - startTime) / 1000)}s`,
    ].join("\n");

    return {
      content: [{ type: "text", text: summary }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
