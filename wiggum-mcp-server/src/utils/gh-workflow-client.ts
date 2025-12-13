/**
 * MCP Client wrapper for gh-workflow-mcp-server
 *
 * This module provides a singleton client connection to gh-workflow-mcp-server,
 * allowing wiggum to call tools like gh_get_failure_details directly via MCP protocol.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from './logger.js';
import type { MonitorResult } from './gh-workflow.js';

let ghWorkflowClient: Client | null = null;

/**
 * Call MCP tool with retry logic for timeout errors
 *
 * The MCP TypeScript SDK has a hardcoded 60-second timeout. For long-running
 * operations (like workflow monitoring), we retry on timeout errors until
 * the operation completes or maxDurationMs is reached.
 *
 * @param client - MCP client instance
 * @param toolName - Name of the tool to call
 * @param args - Tool arguments
 * @param maxDurationMs - Maximum total duration before giving up (default: 10 minutes)
 * @returns Promise resolving to tool result
 */
async function callToolWithRetry(
  client: Client,
  toolName: string,
  args: any,
  maxDurationMs: number = 600000 // 10 minutes
): Promise<any> {
  const startTime = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed >= maxDurationMs) {
      throw new Error(`Operation exceeded maximum duration of ${maxDurationMs}ms`);
    }

    try {
      return await client.callTool({
        name: toolName,
        arguments: args,
      });
    } catch (error: any) {
      // Check if it's the MCP timeout error
      if (error.code === -32001 || error.message?.includes('timeout')) {
        logger.info(`MCP timeout on ${toolName}, retrying...`, {
          elapsed,
          remaining: maxDurationMs - elapsed,
        });
        // Continue loop to retry
        continue;
      }

      // Non-timeout error, fail immediately
      throw error;
    }
  }
}

/**
 * Get or create a client connection to gh-workflow-mcp-server
 *
 * Uses singleton pattern to reuse the same client connection across multiple calls.
 * The client connects to gh-workflow-mcp-server via stdio transport.
 *
 * @returns Promise resolving to MCP Client instance
 */
export async function getGhWorkflowClient(): Promise<Client> {
  if (ghWorkflowClient) {
    return ghWorkflowClient;
  }

  logger.info('Initializing gh-workflow-mcp-server client');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['gh-workflow-mcp-server/dist/index.js'],
  });

  ghWorkflowClient = new Client(
    { name: 'wiggum-orchestrator', version: '1.0.0' },
    { capabilities: {} }
  );

  await ghWorkflowClient.connect(transport);
  logger.info('Connected to gh-workflow-mcp-server');

  return ghWorkflowClient;
}

/**
 * Call gh_get_failure_details tool from gh-workflow-mcp-server
 *
 * Retrieves comprehensive failure information including:
 * - Failed job names and URLs
 * - Test failures with file locations
 * - Error messages and stack traces
 * - Framework-specific error parsing (Go, Playwright, TAP)
 *
 * @param params - Parameters for gh_get_failure_details tool
 * @param params.run_id - Workflow run ID (optional)
 * @param params.pr_number - PR number (optional)
 * @param params.branch - Branch name (optional)
 * @param params.max_chars - Maximum characters to return (default: 10000)
 * @returns Promise resolving to formatted failure details as text
 * @throws Error if tool returns no text content
 */
export async function getFailureDetails(params: {
  run_id?: number;
  pr_number?: number;
  branch?: string;
  max_chars?: number;
}): Promise<string> {
  const client = await getGhWorkflowClient();

  logger.info('Calling gh_get_failure_details', { params });

  const result = await client.callTool({
    name: 'gh_get_failure_details',
    arguments: params,
  });

  if (result.content && Array.isArray(result.content) && result.content.length > 0) {
    const textContent = result.content.find((c: any) => c.type === 'text');
    if (textContent && 'text' in textContent) {
      logger.info('Retrieved failure details', {
        length: textContent.text.length,
      });
      return textContent.text;
    }
  }

  throw new Error('No text content in gh_get_failure_details response');
}

/**
 * Monitor a workflow run until completion
 *
 * Delegates to gh_monitor_run MCP tool and parses the result into MonitorResult format.
 *
 * @param params - Monitoring parameters
 * @param params.branch - Branch name to monitor
 * @param params.poll_interval_seconds - Polling interval (default: 10)
 * @param params.timeout_seconds - Timeout in seconds (default: 600)
 * @param params.fail_fast - Exit on first failure (default: true)
 * @returns Promise resolving to MonitorResult with success status and summary
 */
export async function monitorRun(params: {
  branch: string;
  poll_interval_seconds?: number;
  timeout_seconds?: number;
  fail_fast?: boolean;
}): Promise<MonitorResult> {
  const client = await getGhWorkflowClient();

  logger.info('Calling gh_monitor_run', { params });

  const result = await callToolWithRetry(
    client,
    'gh_monitor_run',
    {
      branch: params.branch,
      poll_interval_seconds: params.poll_interval_seconds ?? 10,
      timeout_seconds: params.timeout_seconds ?? 600,
      fail_fast: params.fail_fast ?? true,
    },
    (params.timeout_seconds ?? 600) * 1000 // Convert to milliseconds
  );

  return parseWorkflowMonitorResult(result, params.branch);
}

/**
 * Monitor PR checks until completion
 *
 * Delegates to gh_monitor_pr_checks MCP tool and parses the result into MonitorResult format.
 *
 * @param params - Monitoring parameters
 * @param params.pr_number - PR number to monitor
 * @param params.poll_interval_seconds - Polling interval (default: 10)
 * @param params.timeout_seconds - Timeout in seconds (default: 600)
 * @param params.fail_fast - Exit on first failure (default: true)
 * @returns Promise resolving to MonitorResult with success status and summary
 */
export async function monitorPRChecks(params: {
  pr_number: number;
  poll_interval_seconds?: number;
  timeout_seconds?: number;
  fail_fast?: boolean;
}): Promise<MonitorResult> {
  const client = await getGhWorkflowClient();

  logger.info('Calling gh_monitor_pr_checks', { params });

  const result = await callToolWithRetry(
    client,
    'gh_monitor_pr_checks',
    {
      pr_number: params.pr_number,
      poll_interval_seconds: params.poll_interval_seconds ?? 10,
      timeout_seconds: params.timeout_seconds ?? 600,
      fail_fast: params.fail_fast ?? true,
    },
    (params.timeout_seconds ?? 600) * 1000 // Convert to milliseconds
  );

  return parsePRChecksMonitorResult(result, params.pr_number);
}

/**
 * Parse gh_monitor_run MCP tool result into MonitorResult format
 *
 * Extracts success/failure from workflow conclusion and formats error summary.
 *
 * @param result - Raw MCP tool result
 * @param branch - Branch name for context
 * @returns MonitorResult with success boolean and error summary
 */
function parseWorkflowMonitorResult(result: any, branch: string): MonitorResult {
  // Extract text from result
  if (!result.content || !Array.isArray(result.content) || result.content.length === 0) {
    throw new Error('No content in gh_monitor_run response');
  }

  const textContent = result.content.find((c: any) => c.type === 'text');
  if (!textContent || !('text' in textContent)) {
    throw new Error('No text content in gh_monitor_run response');
  }

  const text = textContent.text;
  logger.info('Parsed workflow monitor result', { textLength: text.length });

  // Parse the text to determine success/failure
  // Look for "Conclusion: success" vs other conclusions
  const conclusionMatch = text.match(/Conclusion: (\w+)/);
  const conclusion = conclusionMatch ? conclusionMatch[1] : null;

  const success = conclusion === 'success';

  if (success) {
    return { success: true };
  } else {
    // On failure, call getFailureDetails for detailed error information
    logger.info('Workflow failed, retrieving detailed failure information', {
      branch,
      conclusion,
    });

    // Note: We'll call getFailureDetails in the calling code (gh-workflow.ts)
    // to maintain the pattern already established
    return {
      success: false,
      errorSummary: `Workflow failed with conclusion: ${conclusion || 'unknown'}`,
    };
  }
}

/**
 * Parse gh_monitor_pr_checks MCP tool result into MonitorResult format
 *
 * Extracts success/failure from overall status and formats error summary.
 *
 * @param result - Raw MCP tool result
 * @param prNumber - PR number for context
 * @returns MonitorResult with success boolean and error summary
 */
function parsePRChecksMonitorResult(result: any, prNumber: number): MonitorResult {
  // Extract text from result
  if (!result.content || !Array.isArray(result.content) || result.content.length === 0) {
    throw new Error('No content in gh_monitor_pr_checks response');
  }

  const textContent = result.content.find((c: any) => c.type === 'text');
  if (!textContent || !('text' in textContent)) {
    throw new Error('No text content in gh_monitor_pr_checks response');
  }

  const text = textContent.text;
  logger.info('Parsed PR checks monitor result', { textLength: text.length });

  // Parse failure count from summary line: "Success: N, Failed: N, Other: N"
  const failureMatch = text.match(/Failed: (\d+)/);
  const failureCount = failureMatch ? parseInt(failureMatch[1], 10) : null;

  // Parse overall status as fallback context
  const statusMatch = text.match(/Overall Status: (\w+)/);
  const overallStatus = statusMatch ? statusMatch[1] : null;

  // Determine success based on failure count (preferred) or status (fallback)
  let success: boolean;
  if (failureCount !== null) {
    // Primary logic: success if no failures, regardless of skipped/other checks
    success = failureCount === 0;
    logger.info('Determined success from failure count', { failureCount, success, overallStatus });
  } else {
    // Fallback: use status-based logic if failure count not parseable
    success = overallStatus === 'SUCCESS' || overallStatus === 'BLOCKED';
    logger.info('Determined success from status (fallback)', { overallStatus, success });
  }

  if (success) {
    return { success: true };
  } else {
    // On failure, call getFailureDetails for detailed error information
    logger.info('PR checks failed, retrieving detailed failure information', {
      prNumber,
      overallStatus,
      failureCount,
    });

    return {
      success: false,
      errorSummary: `PR checks failed with status: ${overallStatus || 'unknown'} (${failureCount ?? '?'} failures)`,
    };
  }
}
