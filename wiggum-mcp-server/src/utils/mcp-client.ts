/**
 * MCP client utilities for calling other MCP tools
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Map of server names to their executable commands
 */
const SERVER_COMMANDS: Record<string, string> = {
  'gh-workflow': 'gh-workflow-mcp-server',
};

/**
 * Call a tool on another MCP server via stdio
 *
 * @param serverName - The name of the MCP server (e.g., 'gh-workflow')
 * @param toolName - The name of the tool to call (e.g., 'gh_get_failure_details')
 * @param args - The arguments to pass to the tool
 * @returns The tool result
 */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const command = SERVER_COMMANDS[serverName];
  if (!command) {
    throw new Error(`Unknown MCP server: ${serverName}`);
  }

  // Create client
  const client = new Client(
    {
      name: 'wiggum-mcp-client',
      version: '0.1.0',
    },
    {
      capabilities: {},
    }
  );

  // Create stdio transport
  const transport = new StdioClientTransport({
    command,
    args: [],
  });

  try {
    // Connect to the server
    await client.connect(transport);

    // Call the tool
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    // Return the result
    return result as McpToolResult;
  } finally {
    // Always close the transport
    await transport.close();
  }
}
