/**
 * Tool: wiggum_complete_pr_review
 *
 * Called after /pr-review-toolkit:review-pr to report results
 */

import { z } from 'zod';
import {
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE2_PR_REVIEW,
  PHASE1_PR_REVIEW_COMMAND,
  PHASE2_PR_REVIEW_COMMAND,
} from '../constants.js';
import type { ToolResult } from '../types.js';
import {
  completeReview,
  type ReviewCompletionInput,
  type ReviewConfig,
} from './review-completion-helper.js';

export const CompletePRReviewInputSchema = z.object({
  command_executed: z
    .boolean()
    .describe('Confirm /pr-review-toolkit:review-pr was actually executed'),
  verbatim_response: z.string().describe('Complete verbatim response from review command'),
  high_priority_issues: z.number().describe('Count of high priority issues found'),
  medium_priority_issues: z.number().describe('Count of medium priority issues found'),
  low_priority_issues: z.number().describe('Count of low priority issues found'),
});

export type CompletePRReviewInput = z.infer<typeof CompletePRReviewInputSchema>;

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
 * TODO: See issue #314 - Replace silent fallback with ValidationError when issueNumber undefined
 */
export async function completePRReview(input: CompletePRReviewInput): Promise<ToolResult> {
  const reviewInput: ReviewCompletionInput = {
    command_executed: input.command_executed,
    verbatim_response: input.verbatim_response,
    high_priority_issues: input.high_priority_issues,
    medium_priority_issues: input.medium_priority_issues,
    low_priority_issues: input.low_priority_issues,
  };

  return completeReview(reviewInput, PR_REVIEW_CONFIG);
}
