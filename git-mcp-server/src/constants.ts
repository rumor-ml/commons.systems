/**
 * Shared constants for Git MCP server
 */

// Maximum characters to return in tool responses to stay within token limits
export const MAX_RESPONSE_LENGTH = 10000;

// Polling intervals in milliseconds
export const DEFAULT_POLL_INTERVAL_MS = 5000;
export const MAX_POLL_INTERVAL_MS = 30000;

// Timeouts
export const DEFAULT_TIMEOUT_MS = 600000; // 10 minutes
