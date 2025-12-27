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
  FAILURE_CONCLUSIONS,
} from '../constants.js';
import { getWorkflowRunsForPR, getPR, resolveRepo, sleep } from '../utils/gh-cli.js';
import { TimeoutError, ValidationError, createErrorResult } from '../utils/errors.js';
import { watchPRChecks, getCheckIcon, determineOverallStatus } from '../utils/gh-watch.js';

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

    let checks: CheckData[] = [];
    let failedEarly = false;

    // Use watch for completion detection with optional fail-fast polling
    // Hybrid approach: gh pr checks --watch provides completion signal, while
    // polling JSON API enables fail-fast detection without waiting for all checks
    if (input.fail_fast) {
      // Hybrid: Race between watch and polling for fail-fast detection
      const watchPromise = watchPRChecks(input.pr_number, {
        timeout: timeoutMs,
        repo: resolvedRepo,
      });

      const failFastPromise = (async () => {
        while (Date.now() - startTime < timeoutMs) {
          checks = (await getWorkflowRunsForPR(input.pr_number, resolvedRepo)) as CheckData[];

          if (checks && checks.length > 0) {
            const failedCheck = checks.find(
              (check) => check.conclusion && FAILURE_CONCLUSIONS.includes(check.conclusion)
            );

            if (failedCheck) {
              failedEarly = true;
              return;
            }
          }

          await sleep(pollIntervalMs);
        }
      })();

      await Promise.race([watchPromise, failFastPromise]);
    } else {
      // Simple watch until completion
      const watchResult = await watchPRChecks(input.pr_number, {
        timeout: timeoutMs,
        repo: resolvedRepo,
      });

      if (watchResult.timedOut) {
        throw new TimeoutError(
          `PR checks did not complete within ${input.timeout_seconds} seconds`
        );
      }
    }

    // Fetch structured data after watch completes
    checks = (await getWorkflowRunsForPR(input.pr_number, resolvedRepo)) as CheckData[];

    // Re-check for fail-fast condition to set failedEarly flag (if not already set)
    if (input.fail_fast && !failedEarly) {
      const failedCheck = checks.find(
        (check) => check.conclusion && FAILURE_CONCLUSIONS.includes(check.conclusion)
      );
      if (failedCheck) {
        failedEarly = true;
      }
    }

    // Summarize results using new utilities
    const overallStatusData = determineOverallStatus(checks);
    const { successCount, failureCount, otherCount } = overallStatusData;

    const checkSummaries = checks.map((check) => {
      const icon = getCheckIcon(check.conclusion);
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
      // Standard check-based status (from utility)
      overallStatus = overallStatusData.status;
    }

    const headerSuffix = failedEarly ? ' (early exit)' : '';
    const monitoringSuffix = failedEarly ? ' (fail-fast enabled)' : '';
    const totalDurationSeconds = Math.round((Date.now() - startTime) / 1000);

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
      `Monitoring completed in ${totalDurationSeconds}s${monitoringSuffix}`,
    ].join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
