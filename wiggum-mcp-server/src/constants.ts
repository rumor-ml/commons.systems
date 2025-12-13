/**
 * Shared constants for Wiggum MCP server
 */

// Maximum characters to return in tool responses to stay within token limits
export const MAX_RESPONSE_LENGTH = 10000;
export const WORKFLOW_LOG_MAX_CHARS = 50000; // For complete error logs in automated workflows
export const WORKFLOW_MONITOR_TIMEOUT_MS = 600000; // 10 minutes for workflow/PR check monitoring

// Wiggum flow constants
export const MAX_ITERATIONS = 10;
export const NEEDS_REVIEW_LABEL = 'needs review';
export const CODE_QUALITY_BOT_USERNAME = 'github-code-quality[bot]';

// Step identifiers
// Using const assertions to ensure these are exact literal types
export const STEP_ENSURE_PR = '0' as const;
export const STEP_MONITOR_WORKFLOW = '1' as const;
export const STEP_MONITOR_PR_CHECKS = '1b' as const;
export const STEP_CODE_QUALITY = '2' as const;
export const STEP_PR_REVIEW = '3' as const;
export const STEP_SECURITY_REVIEW = '4' as const;
export const STEP_VERIFY_REVIEWS = '4b' as const;
export const STEP_APPROVAL = 'approval' as const;

/**
 * Valid step identifiers in the Wiggum workflow
 * Using a discriminated union to enforce type safety and prevent invalid steps
 */
export type WiggumStep =
  | typeof STEP_ENSURE_PR
  | typeof STEP_MONITOR_WORKFLOW
  | typeof STEP_MONITOR_PR_CHECKS
  | typeof STEP_CODE_QUALITY
  | typeof STEP_PR_REVIEW
  | typeof STEP_SECURITY_REVIEW
  | typeof STEP_VERIFY_REVIEWS
  | typeof STEP_APPROVAL;

/**
 * Ordered list of steps in the Wiggum workflow
 * Used for step index calculations and filtering
 */
export const STEP_ORDER: readonly WiggumStep[] = [
  STEP_ENSURE_PR,
  STEP_MONITOR_WORKFLOW,
  STEP_MONITOR_PR_CHECKS,
  STEP_CODE_QUALITY,
  STEP_PR_REVIEW,
  STEP_SECURITY_REVIEW,
  STEP_VERIFY_REVIEWS,
  STEP_APPROVAL,
] as const;

/**
 * Validates if a string is a valid WiggumStep
 * @param step - The step to validate
 * @returns true if the step is valid
 */
export function isValidStep(step: unknown): step is WiggumStep {
  return (
    step === STEP_ENSURE_PR ||
    step === STEP_MONITOR_WORKFLOW ||
    step === STEP_MONITOR_PR_CHECKS ||
    step === STEP_CODE_QUALITY ||
    step === STEP_PR_REVIEW ||
    step === STEP_SECURITY_REVIEW ||
    step === STEP_VERIFY_REVIEWS ||
    step === STEP_APPROVAL
  );
}

// Step names (human-readable)
export const STEP_NAMES: Record<WiggumStep, string> = {
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
export const PR_REVIEW_COMMAND = '/pr-review-toolkit:review-pr' as const;
export const SECURITY_REVIEW_COMMAND = '/security-review' as const;

// PR check failure states (used for fail-fast logic)
export const FAILURE_STATES = ['FAILURE', 'ERROR'] as const;
