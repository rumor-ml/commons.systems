/**
 * GitHub Actions workflow monitoring utilities
 *
 * This module provides a thin wrapper around gh-workflow-mcp-server tools,
 * delegating monitoring operations to the MCP server instead of implementing
 * custom polling logic.
 */

import { logger } from './logger.js';
import {
  monitorRun as clientMonitorRun,
  monitorPRChecks as clientMonitorPRChecks,
  getFailureDetails,
} from './gh-workflow-client.js';
import { WORKFLOW_LOG_MAX_CHARS, WORKFLOW_MONITOR_TIMEOUT_MS } from '../constants.js';

export interface MonitorResult {
  success: boolean;
  errorSummary?: string;
  failureDetails?: string; // Formatted error details from gh_get_failure_details
  enrichmentError?: string; // Error message if failure detail enrichment failed
}

/**
 * Monitor a workflow run until completion
 *
 * Delegates to gh_monitor_run MCP tool via gh-workflow-client.
 *
 * @param branch - Branch name to monitor
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 600000 = 10 minutes)
 * @returns MonitorResult with success status and optional error summary
 *
 * @example
 * ```typescript
 * const result = await monitorRun('feature-123');
 * if (!result.success) {
 *   console.log(result.errorSummary);
 * }
 * ```
 */
export async function monitorRun(
  branch: string,
  timeoutMs = WORKFLOW_MONITOR_TIMEOUT_MS
): Promise<MonitorResult> {
  logger.info('monitorRun delegating to gh_monitor_run MCP tool', { branch, timeoutMs });

  const result = await clientMonitorRun({
    branch,
    poll_interval_seconds: 10,
    timeout_seconds: Math.floor(timeoutMs / 1000),
    fail_fast: true,
  });

  // If failed, enrich with failure details
  // TODO(#272): Surface enrichment errors to users in failure messages
  // Current: enrichment failures only logged, not shown to users (see PR review #273)
  if (!result.success && !result.failureDetails) {
    logger.info('Enriching failure result with detailed failure information', { branch });
    try {
      const failureDetails = await getFailureDetails({
        branch: branch,
        max_chars: WORKFLOW_LOG_MAX_CHARS,
      });
      result.failureDetails = failureDetails;
    } catch (enrichmentError) {
      // Log enrichment failure but preserve original failure information
      // The workflow already failed - don't crash on enrichment errors
      const enrichmentErrorMsg =
        enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError);
      logger.warn('Failed to enrich failure result with detailed information', {
        branch,
        error: enrichmentErrorMsg,
      });
      // Surface enrichment error in result for debugging
      result.enrichmentError = `Failed to fetch detailed failure information: ${enrichmentErrorMsg}`;
    }
  }

  return result;
}

/**
 * Monitor PR checks until all complete
 *
 * Delegates to gh_monitor_pr_checks MCP tool via gh-workflow-client.
 *
 * @param prNumber - PR number to monitor
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 600000 = 10 minutes)
 * @returns MonitorResult with success status and optional error summary
 *
 * @example
 * ```typescript
 * const result = await monitorPRChecks(123);
 * if (!result.success) {
 *   console.log(result.errorSummary);
 * }
 * ```
 */
export async function monitorPRChecks(
  prNumber: number,
  timeoutMs = WORKFLOW_MONITOR_TIMEOUT_MS
): Promise<MonitorResult> {
  logger.info('monitorPRChecks delegating to gh_monitor_pr_checks MCP tool', {
    prNumber,
    timeoutMs,
  });

  const result = await clientMonitorPRChecks({
    pr_number: prNumber,
    poll_interval_seconds: 10,
    timeout_seconds: Math.floor(timeoutMs / 1000),
    fail_fast: true,
  });

  // If failed, enrich with failure details
  // TODO(#299): Extract duplicated enrichment logic to helper function
  if (!result.success && !result.failureDetails) {
    logger.info('Enriching failure result with detailed failure information', { prNumber });
    try {
      const failureDetails = await getFailureDetails({
        pr_number: prNumber,
        max_chars: WORKFLOW_LOG_MAX_CHARS,
      });
      result.failureDetails = failureDetails;
    } catch (enrichmentError) {
      // Log enrichment failure but preserve original failure information
      // The workflow already failed - don't crash on enrichment errors
      const enrichmentErrorMsg =
        enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError);
      logger.warn('Failed to enrich failure result with detailed information', {
        prNumber,
        error: enrichmentErrorMsg,
      });
      // Surface enrichment error in result for debugging
      result.enrichmentError = `Failed to fetch detailed failure information: ${enrichmentErrorMsg}`;
    }
  }

  return result;
}
