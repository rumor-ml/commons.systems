#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "git-mcp-server",
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
      // TODO: Add your tool definitions here
      // Example:
      // {
      //   name: "git_example_tool",
      //   description: "Example tool description",
      //   inputSchema: {
      //     type: "object",
      //     properties: {
      //       param: {
      //         type: "string",
      //         description: "Parameter description",
      //       },
      //     },
      //     required: ["param"],
      //   },
      // },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // TODO: Add your tool handlers here
      // Example:
      // case "git_example_tool": {
      //   const validated = ExampleToolInputSchema.parse(args);
      //   const result = await handleExampleTool(validated);
      //   return {
      //     content: [{ type: "text", text: result }],
      //   };
      // }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
    throw error;
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Git MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
