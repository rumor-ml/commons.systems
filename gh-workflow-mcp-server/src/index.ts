#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import {
  monitorRun,
  MonitorRunInputSchema,
} from "./tools/monitor-run.js";
import {
  monitorPRChecks,
  MonitorPRChecksInputSchema,
} from "./tools/monitor-pr-checks.js";
import {
  monitorMergeQueue,
  MonitorMergeQueueInputSchema,
} from "./tools/monitor-merge-queue.js";
import {
  getDeploymentUrls,
  GetDeploymentUrlsInputSchema,
} from "./tools/get-deployment-urls.js";
import {
  getFailureDetails,
  GetFailureDetailsInputSchema,
} from "./tools/get-failure-details.js";

import { createErrorResult } from "./utils/errors.js";
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_TIMEOUT,
  DEFAULT_MERGE_QUEUE_POLL_INTERVAL,
  DEFAULT_MERGE_QUEUE_TIMEOUT,
  MIN_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  MAX_TIMEOUT,
  MAX_RESPONSE_LENGTH,
} from "./constants.js";

const server = new Server(
  {
    name: "gh-workflow-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "gh_monitor_run",
        description:
          "Monitor a GitHub Actions workflow run until completion. Supports monitoring by run_id, pr_number, or branch name. Returns a structured summary with status, conclusion, duration, and job details.",
        inputSchema: {
          type: "object",
          properties: {
            run_id: {
              type: "number",
              description: "Workflow run ID to monitor",
            },
            pr_number: {
              type: "number",
              description: "PR number to monitor (will monitor latest run for this PR)",
            },
            branch: {
              type: "string",
              description: "Branch name to monitor (will monitor latest run for this branch)",
            },
            repo: {
              type: "string",
              description:
                'Repository in format "owner/repo" (defaults to current repository)',
            },
            poll_interval_seconds: {
              type: "number",
              description: `Polling interval in seconds (default: ${DEFAULT_POLL_INTERVAL}, min: ${MIN_POLL_INTERVAL}, max: ${MAX_POLL_INTERVAL})`,
              default: DEFAULT_POLL_INTERVAL,
            },
            timeout_seconds: {
              type: "number",
              description: `Maximum time to wait in seconds (default: ${DEFAULT_TIMEOUT}, max: ${MAX_TIMEOUT})`,
              default: DEFAULT_TIMEOUT,
            },
          },
          required: [],
        },
      },
      {
        name: "gh_monitor_pr_checks",
        description:
          "Monitor all status checks for a pull request until they complete. Returns a summary of all checks with their status and conclusions, including success/failure counts.",
        inputSchema: {
          type: "object",
          properties: {
            pr_number: {
              type: "number",
              description: "PR number to monitor",
            },
            repo: {
              type: "string",
              description:
                'Repository in format "owner/repo" (defaults to current repository)',
            },
            poll_interval_seconds: {
              type: "number",
              description: `Polling interval in seconds (default: ${DEFAULT_POLL_INTERVAL}, min: ${MIN_POLL_INTERVAL}, max: ${MAX_POLL_INTERVAL})`,
              default: DEFAULT_POLL_INTERVAL,
            },
            timeout_seconds: {
              type: "number",
              description: `Maximum time to wait in seconds (default: ${DEFAULT_TIMEOUT}, max: ${MAX_TIMEOUT})`,
              default: DEFAULT_TIMEOUT,
            },
          },
          required: ["pr_number"],
        },
      },
      {
        name: "gh_monitor_merge_queue",
        description:
          "Track a pull request through the GitHub merge queue until it merges or fails. Monitors merge state status and provides updates on queue position and merge progress.",
        inputSchema: {
          type: "object",
          properties: {
            pr_number: {
              type: "number",
              description: "PR number to track through merge queue",
            },
            repo: {
              type: "string",
              description:
                'Repository in format "owner/repo" (defaults to current repository)',
            },
            poll_interval_seconds: {
              type: "number",
              description: `Polling interval in seconds (default: ${DEFAULT_MERGE_QUEUE_POLL_INTERVAL}, min: ${MIN_POLL_INTERVAL}, max: ${MAX_POLL_INTERVAL})`,
              default: DEFAULT_MERGE_QUEUE_POLL_INTERVAL,
            },
            timeout_seconds: {
              type: "number",
              description: `Maximum time to wait in seconds (default: ${DEFAULT_MERGE_QUEUE_TIMEOUT}, max: ${MAX_TIMEOUT})`,
              default: DEFAULT_MERGE_QUEUE_TIMEOUT,
            },
          },
          required: ["pr_number"],
        },
      },
      {
        name: "gh_get_deployment_urls",
        description:
          "Extract deployment URLs from workflow run logs. Searches through job logs for deployment-related URLs (preview deployments, production deploys, etc.) and returns them with context about which job produced them.",
        inputSchema: {
          type: "object",
          properties: {
            run_id: {
              type: "number",
              description: "Workflow run ID to extract URLs from",
            },
            pr_number: {
              type: "number",
              description:
                "PR number to extract URLs from (will use latest run for this PR)",
            },
            branch: {
              type: "string",
              description:
                "Branch name to extract URLs from (will use latest run for this branch)",
            },
            repo: {
              type: "string",
              description:
                'Repository in format "owner/repo" (defaults to current repository)',
            },
          },
          required: [],
        },
      },
      {
        name: "gh_get_failure_details",
        description:
          "Get a token-efficient summary of workflow failures. Extracts relevant error messages and context from failed jobs, providing a concise overview of what went wrong without overwhelming with logs.",
        inputSchema: {
          type: "object",
          properties: {
            run_id: {
              type: "number",
              description: "Workflow run ID to analyze",
            },
            pr_number: {
              type: "number",
              description: "PR number to analyze (will use latest run for this PR)",
            },
            branch: {
              type: "string",
              description:
                "Branch name to analyze (will use latest run for this branch)",
            },
            repo: {
              type: "string",
              description:
                'Repository in format "owner/repo" (defaults to current repository)',
            },
            max_chars: {
              type: "number",
              description: `Maximum characters to return (default: ${MAX_RESPONSE_LENGTH})`,
              default: MAX_RESPONSE_LENGTH,
            },
          },
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "gh_monitor_run": {
        const validated = MonitorRunInputSchema.parse(args);
        return await monitorRun(validated);
      }

      case "gh_monitor_pr_checks": {
        const validated = MonitorPRChecksInputSchema.parse(args);
        return await monitorPRChecks(validated);
      }

      case "gh_monitor_merge_queue": {
        const validated = MonitorMergeQueueInputSchema.parse(args);
        return await monitorMergeQueue(validated);
      }

      case "gh_get_deployment_urls": {
        const validated = GetDeploymentUrlsInputSchema.parse(args);
        return await getDeploymentUrls(validated);
      }

      case "gh_get_failure_details": {
        const validated = GetFailureDetailsInputSchema.parse(args);
        return await getFailureDetails(validated);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return createErrorResult(error);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GitHub Workflow MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
