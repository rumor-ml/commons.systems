/**
 * Common types for Git MCP server
 */

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ErrorResult {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}
