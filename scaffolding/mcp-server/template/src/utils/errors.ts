/**
 * Error handling utilities for {{SERVICE_TITLE}} MCP server
 */

import type { ErrorResult } from "../types.js";

export class McpError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "McpError";
  }
}

export function createErrorResult(error: unknown): ErrorResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
