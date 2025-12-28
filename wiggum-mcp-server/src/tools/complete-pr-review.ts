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
import {
  completeReview,
  validateReviewConfig,
  type ReviewConfig,
} from './review-completion-helper.js';

export const CompletePRReviewInputSchema = z.object({
  command_executed: z
    .literal(true, {
      errorMap: () => ({
        message:
          'command_executed must be true. Execute the review command before calling this tool.',
      }),
    })
    .describe('Confirm PR review command was actually executed (must be true)'),
  in_scope_files: z.array(z.string()).describe('Array of in-scope result file paths'),
  out_of_scope_files: z.array(z.string()).describe('Array of out-of-scope result file paths'),
  in_scope_count: z.number().int().nonnegative().describe('Total in-scope issues'),
  out_of_scope_count: z.number().int().nonnegative().describe('Total out-of-scope issues'),
  maxIterations: z
    .number()
    .int()
    .positive('maxIterations must be a positive integer')
    .optional()
    .describe(
      'Optional custom iteration limit. Use when user approves increasing the limit beyond default.'
    ),
});

export type CompletePRReviewInput = z.infer<typeof CompletePRReviewInputSchema>;

// TODO(#334): Add validation tests for phase-specific fields
// Tests should verify: STEP_PHASE1_PR_REVIEW, STEP_PHASE2_PR_REVIEW match actual workflow steps,
// phase1Command/phase2Command match command registry, step prefixes match phase (p1-/p2-)
// Validate config at module load time to catch misconfigurations early
const PR_REVIEW_CONFIG: ReviewConfig = validateReviewConfig({
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
});

/**
 * Complete PR review and update state
 *
 * Throws ValidationError if issue number is undefined (see review-completion-helper.ts:1279-1282).
 * TODO(#314): Add more actionable error context to help users diagnose state detection issues.
 */
export async function completePRReview(input: CompletePRReviewInput): Promise<ToolResult> {
  return completeReview(input, PR_REVIEW_CONFIG);
}
