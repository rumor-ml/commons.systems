/**
 * Shared constants for Wiggum MCP server
 */

import { ValidationError } from './utils/errors.js';
import { logger } from './utils/logger.js';

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

/**
 * Generate triage instructions for review issues.
 *
 * This function generates a comprehensive multi-step workflow prompt that guides
 * the agent through the triage process for review recommendations. The workflow includes:
 * 1. Entering plan mode
 * 2. Fetching issue context from GitHub
 * 3. Triaging each recommendation as in-scope or out-of-scope
 * 4. Handling ambiguous scope with user clarification
 * 5. Tracking out-of-scope items to existing/new issues
 * 6. Writing a structured plan with in-scope fixes and out-of-scope tracking
 * 7. Executing the plan with fix implementation and TODO comments
 *
 * @param issueNumber - The issue number being worked on (must be positive integer)
 * @param reviewType - Either 'PR' or 'Security'
 * @param totalIssues - Total number of issues found (must be non-negative integer)
 * @returns A multi-step triage workflow prompt with scope boundaries determined by issueNumber
 * @throws {ValidationError} If issueNumber or totalIssues are invalid
 */
export function generateTriageInstructions(
  issueNumber: number,
  reviewType: 'PR' | 'Security',
  totalIssues: number
): string {
  // Validate reviewType
  if (reviewType !== 'PR' && reviewType !== 'Security') {
    throw new ValidationError(
      `Invalid reviewType: ${JSON.stringify(reviewType)}. Must be either 'PR' or 'Security'.`
    );
  }

  // Validate issueNumber
  if (!Number.isFinite(issueNumber) || issueNumber <= 0 || !Number.isInteger(issueNumber)) {
    throw new ValidationError(`Invalid issueNumber: ${issueNumber}. Must be a positive integer.`);
  }

  // Validate totalIssues
  if (!Number.isFinite(totalIssues) || totalIssues < 0 || !Number.isInteger(totalIssues)) {
    // TODO: See issue #312 - Add Sentry error ID for tracking
    throw new ValidationError(
      `Invalid totalIssues: ${totalIssues}. Must be a non-negative integer.`
    );
  }

  logger.info('Generating triage instructions', {
    issueNumber,
    reviewType,
    totalIssues,
  });

  return `${totalIssues} ${reviewType.toLowerCase()} review issue(s) found. Proceeding to triage phase.

## Step 1: Enter Plan Mode

Call the EnterPlanMode tool to enter planning mode for the triage process.

## Step 2: In Plan Mode - Triage Recommendations

**Working on Issue:** #${issueNumber}

### 2a. Fetch Issue Context
Use \`mcp__gh-issue__gh_get_issue_context\` for issue #${issueNumber}.

### 2b. Triage Each Recommendation

For EACH recommendation, determine if **IN SCOPE** or **OUT OF SCOPE**:

**IN SCOPE criteria (must meet at least one):**
- Required to successfully validate implementation of issue #${issueNumber}
- Improves quality of new implementation work specifically
- Required for test coverage of new implementation work

**OUT OF SCOPE criteria:**
- Related to a different issue
- General quality/testing improvements not specific to this implementation
- Recommendations about code not changed in this PR

### 2c. Handle Ambiguous Scope
If scope unclear for any recommendation:
1. Use AskUserQuestion to clarify scope
2. Update issue body with scope clarifications using \`gh issue edit\`

### 2d. Check Existing Issues for Out-of-Scope Items
For each OUT OF SCOPE recommendation:
1. Search existing issues: \`gh issue list -S "search terms" --json number,title,body\`
2. Note existing issue # OR plan to create new issue

### 2e. Write Plan with These Sections

**A. In-Scope Fixes** - All fixes for in-scope recommendations (ALL severities)

**B. Out-of-Scope Tracking** - For each out-of-scope item:
- Summary of recommendation
- Existing issue # OR "Create new issue with title: [title]"
- File/line to add TODO comment

### 2f. Exit Plan Mode
Call ExitPlanMode when plan is complete.

## Step 3: Execute Plan (After Exiting Plan Mode)

1. Use Task tool with subagent_type="accept-edits" to implement ALL in-scope fixes

2. For out-of-scope items (can run in parallel with subagent_type="general-purpose"):
   - Create new issues OR add comments to existing issues
   - Add TODO comments: \`// TODO: See issue #XXX - [brief description]\`

3. Execute /commit-merge-push slash command

4. Call wiggum_complete_fix with:
   - fix_description: Description of in-scope fixes
   - out_of_scope_issues: Array of issue numbers (both new and existing)`;
}
