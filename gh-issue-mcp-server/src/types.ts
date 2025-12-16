/**
 * Common types for GitHub Issue MCP server
 */

// Import shared types from mcp-common
export type { ToolResult, ToolSuccess, ToolError } from '@commons/mcp-common/types';

// Legacy alias for backward compatibility
export type { ToolError as ErrorResult } from '@commons/mcp-common/types';
