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

// Two-phase workflow constants
export type WiggumPhase = 'phase1' | 'phase2';

// Phase 1 step identifiers (pre-PR)
export const STEP_PHASE1_MONITOR_WORKFLOW = 'p1-1' as const;
export const STEP_PHASE1_PR_REVIEW = 'p1-2' as const;
export const STEP_PHASE1_SECURITY_REVIEW = 'p1-3' as const;
export const STEP_PHASE1_CREATE_PR = 'p1-4' as const;

// Phase 2 step identifiers (post-PR)
export const STEP_PHASE2_MONITOR_WORKFLOW = 'p2-1' as const;
export const STEP_PHASE2_MONITOR_CHECKS = 'p2-2' as const;
export const STEP_PHASE2_CODE_QUALITY = 'p2-3' as const;
export const STEP_PHASE2_PR_REVIEW = 'p2-4' as const;
export const STEP_PHASE2_SECURITY_REVIEW = 'p2-5' as const;
export const STEP_PHASE2_APPROVAL = 'approval' as const;

/**
 * Valid step identifiers in the Wiggum workflow
 * Using a discriminated union to enforce type safety and prevent invalid steps
 */
export type WiggumStep =
  | typeof STEP_PHASE1_MONITOR_WORKFLOW
  | typeof STEP_PHASE1_PR_REVIEW
  | typeof STEP_PHASE1_SECURITY_REVIEW
  | typeof STEP_PHASE1_CREATE_PR
  | typeof STEP_PHASE2_MONITOR_WORKFLOW
  | typeof STEP_PHASE2_MONITOR_CHECKS
  | typeof STEP_PHASE2_CODE_QUALITY
  | typeof STEP_PHASE2_PR_REVIEW
  | typeof STEP_PHASE2_SECURITY_REVIEW
  | typeof STEP_PHASE2_APPROVAL;

/**
 * Ordered list of steps in the Wiggum workflow
 * Used for step index calculations and filtering
 */
export const STEP_ORDER: readonly WiggumStep[] = [
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE1_CREATE_PR,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_CHECKS,
  STEP_PHASE2_CODE_QUALITY,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
  STEP_PHASE2_APPROVAL,
] as const;

/**
 * Validates if a string is a valid WiggumStep
 * @param step - The step to validate
 * @returns true if the step is valid
 */
export function isValidStep(step: unknown): step is WiggumStep {
  return STEP_ORDER.includes(step as WiggumStep);
}

// Step names (human-readable)
export const STEP_NAMES: Record<WiggumStep, string> = {
  [STEP_PHASE1_MONITOR_WORKFLOW]: 'Phase 1: Monitor Workflow',
  [STEP_PHASE1_PR_REVIEW]: 'Phase 1: Code Review (Pre-PR)',
  [STEP_PHASE1_SECURITY_REVIEW]: 'Phase 1: Security Review (Pre-PR)',
  [STEP_PHASE1_CREATE_PR]: 'Phase 1: Create PR',
  [STEP_PHASE2_MONITOR_WORKFLOW]: 'Phase 2: Monitor Workflow',
  [STEP_PHASE2_MONITOR_CHECKS]: 'Phase 2: Monitor PR Checks',
  [STEP_PHASE2_CODE_QUALITY]: 'Phase 2: Address Code Quality Comments',
  [STEP_PHASE2_PR_REVIEW]: 'Phase 2: PR Review (Post-PR)',
  [STEP_PHASE2_SECURITY_REVIEW]: 'Phase 2: Security Review (Post-PR)',
  [STEP_PHASE2_APPROVAL]: 'Approval',
};

// Comment markers for state tracking
export const WIGGUM_STATE_MARKER = 'wiggum-state';
export const WIGGUM_COMMENT_PREFIX = '## Wiggum:';

// PR Review and Security Review commands
export const PR_REVIEW_COMMAND = '/pr-review-toolkit:review-pr' as const;
export const SECURITY_REVIEW_COMMAND = '/security-review' as const;

// PR check failure states (used for fail-fast logic)
export const FAILURE_STATES = ['FAILURE', 'ERROR'] as const;
