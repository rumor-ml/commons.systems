/**
 * Tool: wiggum_complete_pr_review
 *
 * Called after executing the phase-appropriate PR review command:
 * - Phase 1 (Pre-PR): /all-hands-review
 * - Phase 2 (Post-PR): /review
 */

import { z } from 'zod';
import {
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE2_PR_REVIEW,
  PHASE1_PR_REVIEW_COMMAND,
  PHASE2_PR_REVIEW_COMMAND,
} from '../constants.js';
import type { ToolResult } from '../types.js';
import { completeReview, type ReviewConfig } from './review-completion-helper.js';

export const CompletePRReviewInputSchema = z.object({
  command_executed: z.boolean().describe('Confirm PR review command was actually executed'),
  verbatim_response: z
    .string()
    .optional()
    .describe('DEPRECATED: Complete verbatim response from review command. Use verbatim_response_file instead.'),
  verbatim_response_file: z
    .string()
    .optional()
    .describe('Path to temp file containing complete verbatim response from review command (preferred method)'),
  high_priority_issues: z.number().describe('Count of high priority issues found'),
  medium_priority_issues: z.number().describe('Count of medium priority issues found'),
  low_priority_issues: z.number().describe('Count of low priority issues found'),
});

export type CompletePRReviewInput = z.infer<typeof CompletePRReviewInputSchema>;

// TODO(#334): Add validation tests for phase-specific fields
const PR_REVIEW_CONFIG: ReviewConfig = {
  phase1Step: STEP_PHASE1_PR_REVIEW,
  phase2Step: STEP_PHASE2_PR_REVIEW,
  phase1Command: PHASE1_PR_REVIEW_COMMAND,
  phase2Command: PHASE2_PR_REVIEW_COMMAND,
  reviewTypeLabel: 'PR',
  issueTypeLabel: 'issue(s) found in PR review',
  successMessage: `All automated review checks passed with no concerns identified.

**Review Aspects Covered:**
- Code Quality: Project guidelines compliance (CLAUDE.md)
- Test Coverage: Behavioral coverage and edge cases
- Error Handling: Silent failure detection and logging
- Type Design: Type encapsulation and invariants
- Documentation: Comment accuracy and completeness
- Code Clarity: Simplification opportunities`,
};

/**
 * Complete PR review and update state
 *
 * TODO(#314): Replace silent fallback with ValidationError when issueNumber undefined
 */
export async function completePRReview(input: CompletePRReviewInput): Promise<ToolResult> {
  return completeReview(input, PR_REVIEW_CONFIG);
}
