/**
 * Shared constants for Wiggum MCP server
 */

// Maximum characters to return in tool responses to stay within token limits
export const MAX_RESPONSE_LENGTH = 10000;

// Wiggum flow constants
export const MAX_ITERATIONS = 10;
export const NEEDS_REVIEW_LABEL = 'needs review';
export const CODE_QUALITY_BOT_USERNAME = 'github-code-quality[bot]';

// Step identifiers
export const STEP_ENSURE_PR = '0';
export const STEP_MONITOR_WORKFLOW = '1';
export const STEP_MONITOR_PR_CHECKS = '1b';
export const STEP_CODE_QUALITY = '2';
export const STEP_PR_REVIEW = '3';
export const STEP_SECURITY_REVIEW = '4';
export const STEP_VERIFY_REVIEWS = '4b';
export const STEP_APPROVAL = 'approval';

// Step names (human-readable)
export const STEP_NAMES: Record<string, string> = {
  [STEP_ENSURE_PR]: 'Ensure PR Exists',
  [STEP_MONITOR_WORKFLOW]: 'Monitor Workflow',
  [STEP_MONITOR_PR_CHECKS]: 'Monitor PR Checks',
  [STEP_CODE_QUALITY]: 'Address Code Quality Comments',
  [STEP_PR_REVIEW]: 'PR Review',
  [STEP_SECURITY_REVIEW]: 'Security Review',
  [STEP_VERIFY_REVIEWS]: 'Verify Reviews',
  [STEP_APPROVAL]: 'Approval',
};

// Comment markers for state tracking
export const WIGGUM_STATE_MARKER = 'wiggum-state';
export const WIGGUM_COMMENT_PREFIX = '## Wiggum:';

// PR Review and Security Review commands
export const PR_REVIEW_COMMAND = '/pr-review-toolkit:review-pr';
export const SECURITY_REVIEW_COMMAND = '/security-review';
