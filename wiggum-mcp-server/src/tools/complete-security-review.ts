/**
 * Tool: wiggum_complete_security_review
 *
 * Called after /security-review to report results
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { completeReview, createSecurityReviewConfig } from './review-completion-helper.js';

export const CompleteSecurityReviewInputSchema = z.object({
  command_executed: z
    .literal(true, {
      errorMap: () => ({
        message:
          'command_executed must be true. Execute /security-review before calling this tool.',
      }),
    })
    .describe('Confirm /security-review was actually executed (must be true)'),
  in_scope_result_files: z
    .array(z.string())
    .describe('Array of in-scope result file paths (each file may contain multiple issues)'),
  out_of_scope_result_files: z
    .array(z.string())
    .describe('Array of out-of-scope result file paths (each file may contain multiple issues)'),
  in_scope_issue_count: z
    .number()
    .int()
    .nonnegative()
    .describe('Total count of in-scope security issues across all result files'),
  out_of_scope_issue_count: z
    .number()
    .int()
    .nonnegative()
    .describe('Total count of out-of-scope security issues across all result files'),
  maxIterations: z
    .number()
    .int()
    .positive('maxIterations must be a positive integer')
    .optional()
    .describe(
      'Optional custom iteration limit. Use when user approves increasing the limit beyond default.'
    ),
});

export type CompleteSecurityReviewInput = z.infer<typeof CompleteSecurityReviewInputSchema>;

// Use factory function for validated security review configuration
// This centralizes configuration in review-completion-helper.ts and ensures consistency
const SECURITY_REVIEW_CONFIG = createSecurityReviewConfig();

/**
 * Complete security review and update state
 *
 * Throws ValidationError if issue number is undefined (see review-completion-helper.ts:1294-1296).
 * TODO(#314): Add more actionable error context to help users diagnose state detection issues.
 */
export async function completeSecurityReview(
  input: CompleteSecurityReviewInput
): Promise<ToolResult> {
  return completeReview(input, SECURITY_REVIEW_CONFIG);
}
