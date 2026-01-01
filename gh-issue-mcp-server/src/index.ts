#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { getIssueContext, GetIssueContextInputSchema } from './tools/get-issue-context.js';

import { createErrorResult } from './utils/errors.js';

const server = new Server(
  {
    name: 'gh-issue-mcp-server',
    version: '0.1.0',
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
        name: 'gh_get_issue_context',
        description:
          'Get comprehensive hierarchical context for a GitHub issue. Fetches the issue details, all ancestors (parent chain to root), all children (sub-issues), and all siblings. Returns structured JSON with the complete issue hierarchy. Supports body-only mode for performance optimization.',
        inputSchema: {
          type: 'object',
          properties: {
            issue_number: {
              type: ['string', 'number'],
              description: "Issue number (e.g., 123 or '123')",
            },
            repo: {
              type: 'string',
              description: 'Repository in format "owner/repo" (defaults to current repository)',
            },
            include_comments: {
              type: 'boolean',
              description:
                'Whether to include comments in the response (default: true). Set to false for body-only mode to reduce response size by 60-90% and improve performance.',
            },
          },
          required: ['issue_number'],
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
      case 'gh_get_issue_context': {
        const validated = GetIssueContextInputSchema.parse(args);
        return await getIssueContext(validated);
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
  console.error('GitHub Issue MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
