/**
 * Common types for Wiggum MCP server
 */

/**
 * Metadata that can be attached to tool results
 * Used for error categorization, debugging, and result classification
 *
 * Known properties:
 * - errorType: Category of error (TimeoutError, ValidationError, etc.)
 * - errorCode: Machine-readable error code (TIMEOUT, VALIDATION_ERROR, etc.)
 *
 * Note: Requires index signature for MCP SDK compatibility, but should only
 * use documented properties. Unknown properties should trigger code review.
 */
export interface ToolResultMeta {
  errorType?: string;
  errorCode?: string;
  [key: string]: unknown; // For MCP SDK compatibility - use documented properties above
}

/**
 * Standard tool result returned by MCP tools
 *
 * Properties:
 * - content: Array of text content to return to the user
 * - isError: Flag indicating if the result is an error (default: false)
 * - _meta: Optional metadata for error categorization and debugging
 *
 * Note: Inherits index signature from ToolResultMeta for MCP SDK compatibility
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: ToolResultMeta;
  [key: string]: unknown; // For MCP SDK compatibility
}

/**
 * Error-specific tool result
 *
 * Ensures both isError and _meta are present for error responses.
 * Enforces consistency: if it's an error, it must have metadata.
 */
export interface ErrorResult extends ToolResult {
  isError: true;
  _meta: ToolResultMeta;
}
