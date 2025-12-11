/**
 * MCP client utilities for calling other MCP tools
 *
 * Note: This is a simplified implementation. In production, the MCP server
 * would need to be configured with access to other MCP servers via the
 * MCP protocol's server-to-server communication.
 *
 * For now, this is a placeholder that documents the expected interface.
 */

export interface McpToolCall {
  server: string;
  tool: string;
  args: Record<string, any>;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Call another MCP tool
 *
 * NOTE: This is a placeholder. Actual implementation would require
 * MCP SDK support for server-to-server communication, which is not
 * yet standardized in the MCP protocol.
 *
 * For the initial implementation, the wiggum agent will need to
 * call gh-workflow MCP tools directly rather than having the
 * wiggum MCP server call them.
 */
export async function callMcpTool(_call: McpToolCall): Promise<McpToolResult> {
  throw new Error(
    'MCP server-to-server communication not yet implemented. ' +
      'The wiggum agent should call gh-workflow MCP tools directly.'
  );
}
