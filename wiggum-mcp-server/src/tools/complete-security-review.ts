/**
 * Tool: wiggum_complete_security_review
 *
 * Called after /security-review to report results
 */

import { z } from 'zod';
import {
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
  SECURITY_REVIEW_COMMAND,
} from '../constants.js';
import type { ToolResult } from '../types.js';
import { completeReview, type ReviewCompletionInput, type ReviewConfig } from './review-completion-helper.js';

export const CompleteSecurityReviewInputSchema = z.object({
  command_executed: z.boolean().describe('Confirm /security-review was actually executed'),
  verbatim_response: z.string().describe('Complete verbatim response from security review command'),
  high_priority_issues: z.number().describe('Count of high priority security issues found'),
  medium_priority_issues: z.number().describe('Count of medium priority security issues found'),
  low_priority_issues: z.number().describe('Count of low priority security issues found'),
});

export type CompleteSecurityReviewInput = z.infer<typeof CompleteSecurityReviewInputSchema>;

const SECURITY_REVIEW_CONFIG: ReviewConfig = {
  phase1Step: STEP_PHASE1_SECURITY_REVIEW,
  phase2Step: STEP_PHASE2_SECURITY_REVIEW,
  commandName: SECURITY_REVIEW_COMMAND,
  reviewTypeLabel: 'Security',
  issueTypeLabel: 'security issue(s) found',
  successMessage: `All security checks passed with no vulnerabilities identified.

**Security Aspects Covered:**
- Authentication and authorization
- Input validation and sanitization
- Secrets management
- Dependency vulnerabilities
- Security best practices`,
};

/**
 * Complete security review and update state
 */
/**
 * TODO: See issue #314 - Replace silent fallback with ValidationError when issueNumber undefined
 */
export async function completeSecurityReview(
  input: CompleteSecurityReviewInput
): Promise<ToolResult> {
  const reviewInput: ReviewCompletionInput = {
    command_executed: input.command_executed,
    verbatim_response: input.verbatim_response,
    high_priority_issues: input.high_priority_issues,
    medium_priority_issues: input.medium_priority_issues,
    low_priority_issues: input.low_priority_issues,
  };

  return completeReview(reviewInput, SECURITY_REVIEW_CONFIG);
}
