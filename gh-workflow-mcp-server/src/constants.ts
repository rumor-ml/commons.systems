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
export const COMPLETED_STATUSES = ['completed'];
export const IN_PROGRESS_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];
export const TERMINAL_CONCLUSIONS = ['success', 'failure', 'cancelled', 'timed_out', 'skipped'];
export const FAILURE_CONCLUSIONS = ['failure', 'timed_out'];

// Log parsing
export const URL_PATTERN = /https?:\/\/[^\s]+/g;
export const DEPLOYMENT_URL_KEYWORDS = [
  'deployed',
  'deployment',
  'preview',
  'url:',
  'available at',
  'published to',
];

// GitHub PR check states (different from workflow run statuses)
export const PR_CHECK_IN_PROGRESS_STATES = ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING'];
export const PR_CHECK_TERMINAL_STATES = [
  'SUCCESS',
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'SKIPPED',
  'STALE',
];

// Mapping from PR check terminal states to workflow run conclusions
export const PR_CHECK_TERMINAL_STATE_MAP: Record<string, string> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
  STALE: 'skipped',
};

// High-confidence failure patterns (trigger error extraction)
export const FAILURE_PATTERNS = [
  /✘/, // Playwright failure marker
  /\u2718/, // ✘ character (cross mark) - unicode
  /FAILED:/i, // Explicit failure prefix
  /AssertionError/i, // Node/Jest assertion failures
  /Error: expect\(/i, // Playwright expect failures
  /\d+ failed/i, // Test summary with failures
  /exit code [1-9]/i, // Non-zero exit codes
  /##\[error\]/i, // GitHub Actions error annotation
  /Error:/i, // General error prefix
  /Exception:/i, // Exception messages
  /Traceback/i, // Python tracebacks
  /--- FAIL:/, // Go test failure marker
  /FAIL\t/, // Go package failure (tab after FAIL)
  /panic:/i, // Go panic
  /got:.*want:/i, // Go testify/assertion pattern
  /\.go:\d+:/, // Go file:line error reference
];

// Context patterns (include for additional info)
export const CONTEXT_PATTERNS = [
  /› .*\.spec\.(js|ts):\d+/, // Test file location
  /retry #\d+/i, // Retry markers
];

// Check icon mapping (for getCheckIcon utility)
export const CHECK_ICONS: Record<string, string> = {
  success: '✓',
  failure: '✗',
  timed_out: '✗',
  cancelled: '○',
  skipped: '○',
  null: '○',
} as const;

// Watch defaults (gh CLI native behavior)
export const DEFAULT_WATCH_INTERVAL = 3; // seconds (gh native polling)
