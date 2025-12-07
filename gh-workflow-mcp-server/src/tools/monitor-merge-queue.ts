/**
 * Tool: gh_monitor_merge_queue
 * Track a PR through the GitHub merge queue
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import {
  DEFAULT_MERGE_QUEUE_POLL_INTERVAL,
  DEFAULT_MERGE_QUEUE_TIMEOUT,
  MIN_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  MAX_TIMEOUT,
} from '../constants.js';
import { resolveRepo, sleep, ghCliJson } from '../utils/gh-cli.js';
import { TimeoutError, ValidationError, createErrorResult } from '../utils/errors.js';

export const MonitorMergeQueueInputSchema = z
  .object({
    pr_number: z.number().int().positive(),
    repo: z.string().optional(),
    poll_interval_seconds: z
      .number()
      .int()
      .min(MIN_POLL_INTERVAL)
      .max(MAX_POLL_INTERVAL)
      .default(DEFAULT_MERGE_QUEUE_POLL_INTERVAL),
    timeout_seconds: z
      .number()
      .int()
      .positive()
      .max(MAX_TIMEOUT)
      .default(DEFAULT_MERGE_QUEUE_TIMEOUT),
  })
  .strict();

export type MonitorMergeQueueInput = z.infer<typeof MonitorMergeQueueInputSchema>;

interface PRData {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  mergeable: string;
  mergeStateStatus: string;
  mergedAt?: string;
}

export async function monitorMergeQueue(input: MonitorMergeQueueInput): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);
    const pollIntervalMs = input.poll_interval_seconds * 1000;
    const timeoutMs = input.timeout_seconds * 1000;
    const startTime = Date.now();

    let iterationCount = 0;
    let lastStatus = '';
    const statusHistory: string[] = [];

    while (Date.now() - startTime < timeoutMs) {
      iterationCount++;

      // Get PR details with merge queue information
      const pr = (await ghCliJson(
        [
          'pr',
          'view',
          input.pr_number.toString(),
          '--json',
          'number,title,state,url,headRefName,baseRefName,mergeable,mergeStateStatus,mergedAt',
        ],
        { repo: resolvedRepo }
      )) as PRData;

      // Check if PR is merged
      if (pr.state === 'MERGED' || pr.mergedAt !== null) {
        const mergedAt = pr.mergedAt ? new Date(pr.mergedAt).toISOString() : 'unknown';

        const summary = [
          `PR #${pr.number} Successfully Merged: ${pr.title}`,
          `Merged at: ${mergedAt}`,
          `PR URL: ${pr.url}`,
          ``,
          `Status History:`,
          ...statusHistory.map((s, i) => `  ${i + 1}. ${s}`),
          ``,
          `Total monitoring time: ${Math.round((Date.now() - startTime) / 1000)}s`,
          `Checks performed: ${iterationCount}`,
        ].join('\n');

        return {
          content: [{ type: 'text', text: summary }],
        };
      }

      // Check if PR is closed without merging
      if (pr.state.toLowerCase() !== 'open') {
        throw new ValidationError(
          `PR #${pr.number} was closed without merging (state: ${pr.state})`
        );
      }

      // Track status changes
      const currentStatus = `${pr.mergeStateStatus} (mergeable: ${pr.mergeable})`;
      if (currentStatus !== lastStatus) {
        lastStatus = currentStatus;
        const timestamp = new Date().toISOString();
        statusHistory.push(`${timestamp} - ${currentStatus}`);
      }

      // Check merge state
      if (pr.mergeStateStatus === 'BLOCKED') {
        // Still blocked, keep waiting
        await sleep(pollIntervalMs);
        continue;
      }

      if (pr.mergeStateStatus === 'BEHIND') {
        // Need to update branch
        statusHistory.push(`${new Date().toISOString()} - Branch needs update`);
        await sleep(pollIntervalMs);
        continue;
      }

      // If we get here and state is clean/unstable but not merged yet,
      // the merge queue is processing
      await sleep(pollIntervalMs);
    }

    // Timeout reached
    throw new TimeoutError(
      `PR #${input.pr_number} did not merge within ${input.timeout_seconds} seconds. Last status: ${lastStatus}`
    );
  } catch (error) {
    return createErrorResult(error);
  }
}
