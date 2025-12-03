/**
 * Shared constants for Gh Issue MCP server
 */

// Maximum characters to return in tool responses to stay within token limits
export const MAX_RESPONSE_LENGTH = 10000;

// Polling intervals in milliseconds
export const DEFAULT_POLL_INTERVAL_MS = 5000;
export const MIN_POLL_INTERVAL_MS = 1000;
export const MAX_POLL_INTERVAL_MS = 300000; // 5 minutes

// Timeouts in milliseconds
export const DEFAULT_TIMEOUT_MS = 600000; // 10 minutes
export const MIN_TIMEOUT_MS = 5000; // 5 seconds
export const MAX_TIMEOUT_MS = 3600000; // 1 hour

// Retry configuration
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 1000;
export const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2;
