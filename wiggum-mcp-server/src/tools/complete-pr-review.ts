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

  // DEPRECATED: Keep for backward compatibility during transition
  verbatim_response: z.string().optional().describe('DEPRECATED'),
  verbatim_response_file: z.string().optional().describe('DEPRECATED'),
  high_priority_issues: z.number().optional().describe('DEPRECATED'),
  medium_priority_issues: z.number().optional().describe('DEPRECATED'),
  low_priority_issues: z.number().optional().describe('DEPRECATED'),

  // NEW: File-based scope-separated results
  in_scope_files: z.array(z.string()).optional().describe('Array of in-scope result file paths'),
  out_of_scope_files: z
    .array(z.string())
    .optional()
    .describe('Array of out-of-scope result file paths'),
  in_scope_count: z.number().int().nonnegative().optional().describe('Total in-scope issues'),
  out_of_scope_count: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Total out-of-scope issues'),
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
