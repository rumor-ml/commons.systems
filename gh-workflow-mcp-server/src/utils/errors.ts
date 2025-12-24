/**
 * Error handling utilities for GitHub Workflow MCP server
 *
 * This module provides a typed error hierarchy for categorizing failures in MCP tool operations.
 * Error classes enable:
 * - Type-safe error handling with instanceof checks
 * - Structured error categorization for retry logic
 * - Standardized error result formatting for MCP protocol
 *
 * Error Hierarchy:
 * - McpError: Base class for all MCP-related errors
 *   - TimeoutError: Operation exceeded time limit (may be retryable)
 *   - ValidationError: Invalid input parameters (terminal, not retryable)
 *   - GitHubCliError: GitHub CLI command failures
 *   - ParsingError: Failed to parse external command output
 *   - FormattingError: Failed to format response data
 *
 * @module errors
 */

import type { ToolError } from '@commons/mcp-common/types';
import {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  ParsingError,
  FormattingError,
  formatError,
  isTerminalError,
} from '@commons/mcp-common/errors';
import { createErrorResult } from '@commons/mcp-common/result-builders';

export {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  GitHubCliError,
  ParsingError,
  FormattingError,
  formatError,
  isTerminalError,
  createErrorResult,
};
