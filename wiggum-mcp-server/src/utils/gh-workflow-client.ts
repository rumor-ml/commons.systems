/**
 * MCP Client wrapper for gh-workflow-mcp-server
 *
 * This module provides a singleton client connection to gh-workflow-mcp-server,
 * allowing wiggum to call tools like gh_get_failure_details directly via MCP protocol.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from './logger.js';
import { ParsingError } from './errors.js';
import type { MonitorResult } from './gh-workflow.js';

let ghWorkflowClient: Client | null = null;

/**
 * Extract text content from MCP tool result
 *
 * Provides consistent extraction and validation of text content from MCP responses
 *
 * @param result - MCP tool result
 * @param toolName - Name of tool for error messages
 * @param context - Context string (e.g., branch name, PR number) for error messages
 * @returns Extracted text content
 * @throws Error if result format is invalid
 */
function extractTextFromMCPResult(result: any, toolName: string, context: string): string {
  if (!result.content || !Array.isArray(result.content) || result.content.length === 0) {
    logger.error(`Invalid ${toolName} response: no content array`, {
      hasContent: !!result.content,
      isArray: Array.isArray(result.content),
      context,
    });
    throw new Error(`No content in ${toolName} response for ${context}`);
  }

  const textContent = result.content.find((c: any) => c.type === 'text');
  if (!textContent || !('text' in textContent)) {
    logger.error(`Invalid ${toolName} response: no text content`, {
      contentTypes: result.content.map((c: any) => c.type),
      context,
    });
    throw new Error(`No text content in ${toolName} response for ${context}`);
  }

  return textContent.text;
}

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
 * @throws Error if operation exceeds maxDurationMs or encounters non-timeout error
 */
async function callToolWithRetry(
  client: Client,
  toolName: string,
  args: any,
  maxDurationMs: number = 600000 // 10 minutes
): Promise<any> {
  // Validate timeout
  if (maxDurationMs <= 0) {
    throw new Error(`Invalid maxDurationMs: ${maxDurationMs}. Must be positive.`);
  }

  const startTime = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed >= maxDurationMs) {
      const errorMsg = `Operation exceeded maximum duration of ${maxDurationMs}ms after ${elapsed}ms`;
      logger.error(`callToolWithRetry failed: ${errorMsg}`, { toolName, args });
      throw new Error(errorMsg);
    }

    try {
      return await client.callTool({
        name: toolName,
        arguments: args,
      });
    } catch (error: unknown) {
      // Extract error details once
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode =
        error instanceof Error && 'code' in error ? (error as { code?: number }).code : undefined;

      // Check if it's the MCP timeout error
      // Use strict pattern to avoid false positives from other timeout messages
      const isTimeout =
        error instanceof Error &&
        (errorCode === -32001 || /\b(request|operation) timed? ?out\b/i.test(errorMessage));

      if (isTimeout) {
        // Calculate attempt count estimate (elapsed time / 60s SDK timeout)
        const attemptEstimate = Math.floor(elapsed / 60000) + 1;
        logger.info(
          `MCP timeout on ${toolName}, retrying... (attempt ~${attemptEstimate}, elapsed ${elapsed}ms, remaining ${maxDurationMs - elapsed}ms)`,
          {
            errorMessage,
            errorCode,
          }
        );
        continue;
      }

      // Non-timeout error - include timing context
      logger.error(`callToolWithRetry failed with non-timeout error`, {
        toolName,
        error: errorMessage,
        code: errorCode,
        elapsed,
        remaining: maxDurationMs - elapsed,
      });
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

  // Check if server is built
  const serverPath = resolve('gh-workflow-mcp-server/dist/index.js');
  if (!existsSync(serverPath)) {
    const guidance = [
      `MCP server not found: ${serverPath}`,
      '',
      'To fix: cd gh-workflow-mcp-server && npm run build',
      `Current directory: ${process.cwd()}`
    ].join('\n');
    logger.error('MCP server file not found', { serverPath, cwd: process.cwd() });
    throw new Error(guidance);
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
  });

  const client = new Client(
    { name: 'wiggum-orchestrator', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    logger.info('Connected to gh-workflow-mcp-server');
    ghWorkflowClient = client; // Only set singleton on success
    return ghWorkflowClient;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to connect to gh-workflow-mcp-server', { error: errorMsg });

    const troubleshooting = [
      `Failed to connect: ${errorMsg}`,
      '',
      'Troubleshooting:',
      '1. npm run build in gh-workflow-mcp-server',
      `2. Verify path: ${serverPath}`,
      '3. Check Node.js in PATH: which node'
    ].join('\n');
    throw new Error(troubleshooting);
  }
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

  const result = await callToolWithRetry(
    client,
    'gh_get_failure_details',
    params,
    120000 // 2 minutes should be sufficient
  );

  // Build context string for error messages
  let context: string;
  if (params.run_id) {
    context = `run ${params.run_id}`;
  } else if (params.pr_number) {
    context = `PR #${params.pr_number}`;
  } else if (params.branch) {
    context = `branch ${params.branch}`;
  } else {
    context = 'unknown';
  }

  const text = extractTextFromMCPResult(result, 'gh_get_failure_details', context);

  logger.info('Retrieved failure details', {
    length: text.length,
    context,
  });

  return text;
}

/**
 * Monitor a workflow run until completion
 *
 * Delegates to gh_monitor_run MCP tool and parses the result into MonitorResult format.
 *
 * WHEN TO USE THIS VS MCP TOOL DIRECTLY:
 * - Use this wrapper when you need structured MonitorResult for programmatic checks
 * - Use MCP tool directly (via getGhWorkflowClient) when you want raw text output
 *   for logging/debugging or when you need features not exposed by this wrapper
 * - This wrapper adds automatic retry on MCP timeouts (callToolWithRetry)
 * - This wrapper parses text output into success/failure boolean
 *
 * @param params - Single object containing nested monitoring parameters
 * @param params.branch - Branch name to monitor
 * @param params.poll_interval_seconds - Polling interval (default: 10)
 * @param params.timeout_seconds - Timeout in seconds (default: 600)
 * @param params.fail_fast - Exit on first failure (default: true)
 * @returns Promise resolving to MonitorResult with success status and summary
 * @throws ParsingError if gh_monitor_run response format changes and parsing fails
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
 * WARNING: This parser has fragile coupling to gh-workflow-mcp-server output format.
 * If parsing fails with ParsingError, check if gh-workflow-mcp-server output changed.
 *
 * Expected format patterns:
 *   - "Conclusion: <word>" (e.g., "Conclusion: success", "Conclusion: failure")
 *   - Case-sensitive matching
 *
 * Extracts success/failure from workflow conclusion and formats error summary.
 *
 * @param result - Raw MCP tool result
 * @param branch - Branch name for context
 * @returns MonitorResult with success boolean and error summary
 * @throws ParsingError if result format is invalid or conclusion cannot be parsed
 */
function parseWorkflowMonitorResult(result: any, branch: string): MonitorResult {
  // Extract text from result
  const text = extractTextFromMCPResult(result, 'gh_monitor_run', `branch ${branch}`);
  logger.info('Parsed workflow monitor result', { textLength: text.length, branch });

  // Parse the text to determine success/failure
  // Look for "Conclusion: success" vs other conclusions
  //
  // Expected format from gh_monitor_run:
  //   "Conclusion: success" or "Conclusion: failure" or "Conclusion: cancelled"
  //
  // DESIGN RATIONALE:
  // - Uses \w+ (word characters) for conclusion value to match alphanumeric conclusions
  // - Case-sensitive "Conclusion:" to match exact gh-workflow-mcp-server output format
  // - Expects space after colon, matching standard formatting
  //
  // This regex would break if:
  //   - The text uses different capitalization (e.g., "CONCLUSION:" or "conclusion:")
  //   - The conclusion contains spaces or non-word characters
  //   - The format changes to use different punctuation (e.g., "Conclusion = success")
  const conclusionMatch = text.match(/Conclusion: (\w+)/);
  const conclusion = conclusionMatch ? conclusionMatch[1] : null;

  if (!conclusion) {
    logger.error('Failed to parse conclusion from gh_monitor_run response', {
      branch,
      textSnippet: text.substring(0, 500),
      fullTextLength: text.length,
    });
    throw new ParsingError(
      `Failed to parse workflow conclusion from gh_monitor_run response for branch ${branch}. ` +
        `Expected format "Conclusion: <value>" not found in output. ` +
        `This likely indicates a format change in gh-workflow-mcp-server. ` +
        `Response snippet: ${text.substring(0, 200)}`
    );
  }

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
      errorSummary: `Workflow failed with conclusion: ${conclusion}`,
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
 * @throws ParsingError if result format is invalid or required fields cannot be parsed
 */
// Export internal functions for testing
export const _testExports = {
  callToolWithRetry,
  extractTextFromMCPResult,
};

function parsePRChecksMonitorResult(result: any, prNumber: number): MonitorResult {
  // Extract text from result
  const text = extractTextFromMCPResult(result, 'gh_monitor_pr_checks', `PR #${prNumber}`);
  logger.info('Parsed PR checks monitor result', { textLength: text.length, prNumber });

  // Parse failure count from summary line: "Success: N, Failed: N, Other: N"
  //
  // Expected format from gh_monitor_pr_checks:
  //   "Success: 5, Failed: 2, Other: 1"
  //
  // DESIGN RATIONALE:
  // - Uses \d+ to match one or more digits (simple integer count)
  // - Case-sensitive "Failed:" to match exact gh-workflow-mcp-server output format
  // - Captures numeric value for parsing with parseInt
  //
  // This regex would break if:
  //   - The format uses different capitalization (e.g., "failed:" or "FAILED:")
  //   - The count is not a simple integer (e.g., "Failed: N/A" or "Failed: 2.5")
  //   - The format changes to use different punctuation (e.g., "Failed=2" or "Failed - 2")
  const failureMatch = text.match(/Failed: (\d+)/);
  const failureCount = failureMatch ? parseInt(failureMatch[1], 10) : null;

  // Parse overall status as fallback context
  //
  // Expected format from gh_monitor_pr_checks:
  //   "Overall Status: SUCCESS" or "Overall Status: FAILURE" or "Overall Status: BLOCKED"
  //
  // DESIGN RATIONALE:
  // - Uses \w+ to match alphanumeric status values (SUCCESS, FAILURE, BLOCKED, etc.)
  // - Case-sensitive "Overall Status:" to match exact gh-workflow-mcp-server output format
  // - Provides fallback when failure count parsing fails
  //
  // This regex would break if:
  //   - The status contains spaces or non-word characters
  //   - The format uses different capitalization (e.g., "overall status:" or "Overall status:")
  //   - The format changes to use different punctuation (e.g., "Overall Status = SUCCESS")
  const statusMatch = text.match(/Overall Status: (\w+)/);
  const overallStatus = statusMatch ? statusMatch[1] : null;

  if (failureCount === null && !overallStatus) {
    logger.error('Failed to parse failure count or status from gh_monitor_pr_checks response', {
      prNumber,
      textSnippet: text.substring(0, 500),
      fullTextLength: text.length,
    });
    throw new ParsingError(
      `Failed to parse PR checks result from gh_monitor_pr_checks response for PR #${prNumber}. ` +
        `Expected format "Failed: <number>" and/or "Overall Status: <status>" not found in output. ` +
        `This likely indicates a format change in gh-workflow-mcp-server. ` +
        `Response snippet: ${text.substring(0, 200)}`
    );
  }

  // Determine success based on failure count (preferred) or status (fallback)
  let success: boolean;
  if (failureCount !== null) {
    // Primary logic: success if no failures, regardless of skipped/other checks
    success = failureCount === 0;
    logger.info('Determined success from failure count', {
      failureCount,
      success,
      overallStatus,
      prNumber,
    });
  } else {
    // Fallback: use status-based logic if failure count not parseable
    success = overallStatus === 'SUCCESS' || overallStatus === 'BLOCKED';
    logger.info('Determined success from status (fallback)', { overallStatus, success, prNumber });
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
