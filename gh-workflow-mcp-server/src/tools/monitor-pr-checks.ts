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
} from '../constants.js';
import { ghCli, getPR, resolveRepo } from '../utils/gh-cli.js';
import {
  GitHubCliError,
  TimeoutError,
  ValidationError,
  createErrorResult,
} from '../utils/errors.js';
import { getCheckIcon, determineOverallStatus } from '../utils/check-formatting.js';

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
  state: string;
  bucket: string; // "pass" | "fail" | "pending" | "skipping" | "cancel"
  link: string;
  startedAt: string;
  completedAt?: string;
  workflow: string;
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
 * Map bucket to conclusion for consistency with other tools
 */
function mapBucketToConclusion(bucket: string): string {
  switch (bucket) {
    case 'pass':
      return 'success';
    case 'fail':
      return 'failure';
    case 'cancel':
      return 'cancelled';
    case 'skipping':
      return 'skipped';
    case 'pending':
      return 'pending';
    default:
      return bucket;
  }
}

export async function monitorPRChecks(input: MonitorPRChecksInput): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const resolvedRepo = await resolveRepo(input.repo);

    // Get PR details first
    const pr = (await getPR(input.pr_number, resolvedRepo)) as PRData;

    if (pr.state.toLowerCase() !== 'open') {
      throw new ValidationError(`PR #${input.pr_number} is ${pr.state}, not open`);
    }

    // Build gh pr checks --watch command
    const args = [
      'pr',
      'checks',
      input.pr_number.toString(),
      '--watch',
      '--json',
      'name,state,link,startedAt,completedAt,workflow,bucket',
    ];

    if (input.fail_fast) {
      args.push('--fail-fast');
    }

    if (input.poll_interval_seconds) {
      args.push('-i', input.poll_interval_seconds.toString());
    }

    let checks: CheckData[] = [];
    let failedEarly = false;

    try {
      const output = await ghCli(args, {
        repo: resolvedRepo,
        timeout: input.timeout_seconds * 1000,
      });
      checks = JSON.parse(output);
    } catch (error) {
      // Exit code 8 means checks are still pending (timeout reached)
      // When --fail-fast is used and a check fails, gh CLI exits with code 1
      // In both cases, JSON output is in stdout
      if (error instanceof GitHubCliError && (error.exitCode === 8 || error.exitCode === 1)) {
        // Try to parse stdout which contains the JSON output
        if (error.stdout) {
          try {
            checks = JSON.parse(error.stdout);
            failedEarly = error.exitCode === 1 && input.fail_fast;
          } catch {
            // If JSON parsing fails, throw appropriate error
            if (error.exitCode === 8) {
              throw new TimeoutError(
                `PR checks did not complete within ${input.timeout_seconds} seconds`
              );
            }
            throw error;
          }
        } else {
          // If we don't have stdout, throw appropriate error
          if (error.exitCode === 8) {
            throw new TimeoutError(
              `PR checks did not complete within ${input.timeout_seconds} seconds`
            );
          }
          throw error;
        }
      } else {
        throw error;
      }
    }

    if (!checks || checks.length === 0) {
      return {
        content: [{ type: 'text', text: `PR #${pr.number}: No checks found yet for ${pr.title}` }],
      };
    }

    // Summarize results using bucket field
    const successCount = checks.filter((c) => c.bucket === 'pass').length;
    const failureCount = checks.filter((c) => c.bucket === 'fail').length;
    const pendingCount = checks.filter((c) => c.bucket === 'pending').length;
    const otherCount = checks.length - successCount - failureCount - pendingCount;

    const checkSummaries = checks.map((check) => {
      const conclusion = mapBucketToConclusion(check.bucket);
      const icon = getCheckIcon(check.bucket);
      return `  ${icon} ${check.name}: ${conclusion}`;
    });

    // Determine overall status with merge conflict detection
    const overallStatus = determineOverallStatus(
      {
        successCount,
        failureCount,
        pendingCount,
        totalCount: checks.length,
      },
      {
        mergeable: pr.mergeable,
        mergeStateStatus: pr.mergeStateStatus,
      }
    );

    const headerSuffix = failedEarly ? ' (early exit)' : '';
    const monitoringSuffix = failedEarly ? ' (fail-fast enabled)' : '';
    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

    const summary = [
      `PR #${pr.number} Checks ${failedEarly ? 'Failed' : 'Completed'}${headerSuffix}: ${pr.title}`,
      `Overall Status: ${overallStatus}`,
      `Success: ${successCount}, Failed: ${failureCount}, Pending: ${pendingCount}, Other: ${otherCount}`,
      `Mergeable: ${pr.mergeable}`,
      `Merge State: ${pr.mergeStateStatus}`,
      `PR URL: ${pr.url}`,
      ``,
      `Checks (${checks.length}):`,
      ...checkSummaries,
      ``,
      `Monitoring completed in ${elapsedSeconds}s${monitoringSuffix}`,
    ].join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
