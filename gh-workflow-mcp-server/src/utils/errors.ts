/**
 * Error handling utilities for GitHub Workflow MCP server
 */

import type { ToolResult } from "../types.js";

export class McpError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "McpError";
  }
}

export class GitHubCliError extends McpError {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message, "GH_CLI_ERROR");
    this.name = "GitHubCliError";
  }
}

export class TimeoutError extends McpError {
  constructor(message: string) {
    super(message, "TIMEOUT");
    this.name = "TimeoutError";
  }
}

export class ValidationError extends McpError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export function createErrorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
  };
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isTerminalError(error: unknown): boolean {
  if (error instanceof GitHubCliError) {
    // Some errors are retryable (network issues), others are not
    return error.exitCode !== undefined && error.exitCode !== 0;
  }
  return error instanceof ValidationError;
}
