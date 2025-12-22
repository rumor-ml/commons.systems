/**
 * Tool: gh_monitor_pr_checks
 * Monitor all status checks for a pull request until completion
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_TIMEOUT,
  MIN_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  MAX_TIMEOUT,
  IN_PROGRESS_STATUSES,
  FAILURE_CONCLUSIONS,
} from '../constants.js';
import { getWorkflowRunsForPR, getPR, resolveRepo, sleep } from '../utils/gh-cli.js';
import { TimeoutError, ValidationError, createErrorResult } from '../utils/errors.js';

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
    timeout_seconds: z.number().int().positive().max(MAX_TIMEOUT).default(DEFAULT_TIMEOUT),
    fail_fast: z
      .boolean()
      .default(true)
      .describe(
        'Exit immediately on first failure detection. Set to false to wait for all checks to complete.'
      ),
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
  mergeable: string; // "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  mergeStateStatus: string; // "BLOCKED" | "BEHIND" | "CLEAN" | "DIRTY" | "UNSTABLE" etc.
}

/**
 * Monitor all status checks for a pull request until completion
 *
 * Polls PR status checks until all complete or first failure occurs. Provides
 * merge conflict detection and overall PR mergeability status. Useful for
 * automated workflows waiting on CI/CD checks.
 *
 * @param input - Monitor configuration
 * @param input.pr_number - Pull request number to monitor
 * @param input.repo - Repository in format "owner/repo" (defaults to current)
 * @param input.poll_interval_seconds - Polling frequency (default: 10s)
 * @param input.timeout_seconds - Maximum wait time (default: 600s)
 * @param input.fail_fast - Exit on first failure (default: true)
 *
 * @returns Summary with overall status, check counts, and merge state
 *
 * @throws {ValidationError} If PR not found or not in open state
 * @throws {TimeoutError} If checks don't complete within timeout
 *
 * @example
 * // Monitor PR checks with fail-fast
 * await monitorPRChecks({ pr_number: 42, fail_fast: true });
 *
 * @example
 * // Wait for all checks to complete
 * await monitorPRChecks({ pr_number: 42, fail_fast: false });
 */
export async function monitorPRChecks(input: MonitorPRChecksInput): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);
    const pollIntervalMs = input.poll_interval_seconds * 1000;
    const timeoutMs = input.timeout_seconds * 1000;
    const startTime = Date.now();

    // Get PR details first
    const pr = (await getPR(input.pr_number, resolvedRepo)) as PRData;

    if (pr.state.toLowerCase() !== 'open') {
      throw new ValidationError(`PR #${input.pr_number} is ${pr.state}, not open`);
    }

    // Poll until all checks complete or timeout
    let checks: CheckData[] = [];
    let iterationCount = 0;
    let allComplete = false;
    let failedEarly = false;

    while (Date.now() - startTime < timeoutMs) {
      iterationCount++;
      checks = (await getWorkflowRunsForPR(input.pr_number, resolvedRepo)) as CheckData[];

      if (!checks || checks.length === 0) {
        // No checks yet, keep waiting
        await sleep(pollIntervalMs);
        continue;
      }

      // Check for fail-fast condition before checking if all complete
      if (input.fail_fast) {
        const failedCheck = checks.find(
          (check) => check.conclusion && FAILURE_CONCLUSIONS.includes(check.conclusion)
        );

        if (failedCheck) {
          failedEarly = true;
          break;
        }
      }

      // Check if all checks are complete
      allComplete = checks.every((check) => !IN_PROGRESS_STATUSES.includes(check.status));

      if (allComplete) {
        break;
      }

      await sleep(pollIntervalMs);
    }

    if (!allComplete && !failedEarly) {
      throw new TimeoutError(`PR checks did not complete within ${input.timeout_seconds} seconds`);
    }

    // Summarize results
    const successCount = checks.filter((c) => c.conclusion === 'success').length;
    const failureCount = checks.filter(
      (c) => c.conclusion === 'failure' || c.conclusion === 'timed_out'
    ).length;
    const otherCount = checks.length - successCount - failureCount;

    const checkSummaries = checks.map((check) => {
      const icon =
        check.conclusion === 'success'
          ? '✓'
          : check.conclusion === 'failure' || check.conclusion === 'timed_out'
            ? '✗'
            : '○';
      return `  ${icon} ${check.name}: ${check.conclusion || check.status}`;
    });

    // Determine overall status with merge conflict detection
    let overallStatus: string;
    if (pr.mergeable === 'CONFLICTING') {
      overallStatus = 'CONFLICTS';
    } else if (pr.mergeStateStatus === 'DIRTY' || pr.mergeStateStatus === 'BLOCKED') {
      // If checks passed but PR is blocked/dirty, indicate blocking status
      if (failureCount === 0 && successCount === checks.length) {
        overallStatus = 'BLOCKED';
      } else if (failureCount > 0) {
        overallStatus = 'FAILED';
      } else {
        overallStatus = 'MIXED';
      }
    } else {
      // Standard check-based status
      overallStatus =
        failureCount > 0 ? 'FAILED' : successCount === checks.length ? 'SUCCESS' : 'MIXED';
    }

    const headerSuffix = failedEarly ? ' (early exit)' : '';
    const monitoringSuffix = failedEarly ? ' (fail-fast enabled)' : '';

    const summary = [
      `PR #${pr.number} Checks ${failedEarly ? 'Failed' : 'Completed'}${headerSuffix}: ${pr.title}`,
      `Overall Status: ${overallStatus}`,
      `Success: ${successCount}, Failed: ${failureCount}, Other: ${otherCount}`,
      `Mergeable: ${pr.mergeable}`,
      `Merge State: ${pr.mergeStateStatus}`,
      `PR URL: ${pr.url}`,
      ``,
      `Checks (${checks.length}):`,
      ...checkSummaries,
      ``,
      `Monitoring completed after ${iterationCount} checks over ${Math.round((Date.now() - startTime) / 1000)}s${monitoringSuffix}`,
    ].join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
