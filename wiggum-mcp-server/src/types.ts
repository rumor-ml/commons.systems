/**
 * Common types for Wiggum MCP server
 */

/**
 * Metadata that can be attached to tool results
 * Used for error categorization, debugging, and result classification
 */
export interface ToolResultMeta {
  errorType?: string;
  errorCode?: string;
  [key: string]: unknown;
}

/**
 * Standard tool result returned by MCP tools
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: ToolResultMeta;
  [key: string]: unknown;
}

/**
 * Error-specific tool result
 */
export interface ErrorResult extends ToolResult {
  isError: true;
  _meta: ToolResultMeta;
}
