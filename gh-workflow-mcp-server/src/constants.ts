/**
 * Shared constants for GitHub Workflow MCP server
 */

// Maximum characters to return in tool responses to stay within token limits
export const MAX_RESPONSE_LENGTH = 10000;

// Polling intervals in seconds
export const DEFAULT_POLL_INTERVAL = 10;
export const DEFAULT_MERGE_QUEUE_POLL_INTERVAL = 15;
export const MIN_POLL_INTERVAL = 5;
export const MAX_POLL_INTERVAL = 300;

// Timeouts in seconds
export const DEFAULT_TIMEOUT = 600; // 10 minutes
export const DEFAULT_MERGE_QUEUE_TIMEOUT = 1800; // 30 minutes
export const MAX_TIMEOUT = 3600; // 1 hour

// GitHub workflow statuses
export const COMPLETED_STATUSES = ["completed"];
export const IN_PROGRESS_STATUSES = ["queued", "in_progress", "waiting", "requested", "pending"];
export const TERMINAL_CONCLUSIONS = ["success", "failure", "cancelled", "timed_out", "skipped"];

// Log parsing
export const URL_PATTERN = /https?:\/\/[^\s]+/g;
export const DEPLOYMENT_URL_KEYWORDS = [
  "deployed",
  "deployment",
  "preview",
  "url:",
  "available at",
  "published to",
];

// Error message patterns to extract
export const ERROR_PATTERNS = [
  /Error:/i,
  /Failed:/i,
  /FAIL/i,
  /Exception:/i,
  /Traceback/i,
  /at \w+\.\w+/,
];
