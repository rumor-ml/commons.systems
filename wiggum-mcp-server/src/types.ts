/**
 * Common types for Wiggum MCP server
 */

// Import shared types from mcp-common
import type { ToolResult, ToolSuccess, ToolError } from '@commons/mcp-common/types';

export type { ToolResult, ToolSuccess, ToolError };

// Legacy alias for backward compatibility
export type ErrorResult = ToolError;
