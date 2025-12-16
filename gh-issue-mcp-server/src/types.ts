/**
 * Common types for GitHub Issue MCP server
 */

// Import shared types from mcp-common
export type { ToolResult, ToolSuccess, ToolError } from '@commons/mcp-common/types';

// Legacy alias for backward compatibility
// @deprecated Will be removed in v2.0.0 (planned for Q2 2025)
// Use ToolError directly from @commons/mcp-common/types instead
export type { ToolError as ErrorResult } from '@commons/mcp-common/types';
