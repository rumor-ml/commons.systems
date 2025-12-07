/**
 * Common types for GitHub Issue MCP server
 */

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ErrorResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
  [key: string]: unknown;
}
