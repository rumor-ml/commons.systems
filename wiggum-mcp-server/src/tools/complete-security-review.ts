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
import { completeReview, type ReviewConfig } from './review-completion-helper.js';

export const CompleteSecurityReviewInputSchema = z.object({
  command_executed: z.boolean().describe('Confirm /security-review was actually executed'),
  verbatim_response: z
    .string()
    .optional()
    .describe('DEPRECATED: Complete verbatim response from security review command. Use verbatim_response_file instead.'),
  verbatim_response_file: z
    .string()
    .optional()
    .describe(
      'Path to temp file containing complete verbatim response from security review command (preferred method)'
    ),
  high_priority_issues: z.number().describe('Count of high priority security issues found'),
  medium_priority_issues: z.number().describe('Count of medium priority security issues found'),
  low_priority_issues: z.number().describe('Count of low priority security issues found'),
});

export type CompleteSecurityReviewInput = z.infer<typeof CompleteSecurityReviewInputSchema>;

// TODO(#334): Add validation tests for phase-specific fields
const SECURITY_REVIEW_CONFIG: ReviewConfig = {
  phase1Step: STEP_PHASE1_SECURITY_REVIEW,
  phase2Step: STEP_PHASE2_SECURITY_REVIEW,
  phase1Command: SECURITY_REVIEW_COMMAND,
  phase2Command: SECURITY_REVIEW_COMMAND,
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
 *
 * TODO(#314): Replace silent fallback with ValidationError when issueNumber undefined
 */
export async function completeSecurityReview(
  input: CompleteSecurityReviewInput
): Promise<ToolResult> {
  return completeReview(input, SECURITY_REVIEW_CONFIG);
}
