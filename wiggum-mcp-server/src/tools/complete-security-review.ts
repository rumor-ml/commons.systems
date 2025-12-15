/**
 * Tool: wiggum_complete_security_review
 *
 * Called after /security-review to report results
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { postWiggumStateComment } from '../state/comments.js';
import { getNextStepInstructions } from '../state/router.js';
import {
  MAX_ITERATIONS,
  STEP_SECURITY_REVIEW,
  STEP_NAMES,
  SECURITY_REVIEW_COMMAND,
} from '../constants.js';
import { ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import { formatWiggumResponse } from '../utils/format-response.js';

export const CompleteSecurityReviewInputSchema = z.object({
  command_executed: z.boolean().describe('Confirm /security-review was actually executed'),
  verbatim_response: z.string().describe('Complete verbatim response from security review command'),
  high_priority_issues: z.number().describe('Count of high priority security issues found'),
  medium_priority_issues: z.number().describe('Count of medium priority security issues found'),
  low_priority_issues: z.number().describe('Count of low priority security issues found'),
});

export type CompleteSecurityReviewInput = z.infer<typeof CompleteSecurityReviewInputSchema>;

/**
 * Complete security review and update state
 */
export async function completeSecurityReview(
  input: CompleteSecurityReviewInput
): Promise<ToolResult> {
  // Validate command was actually executed
  if (!input.command_executed) {
    throw new ValidationError(
      'command_executed must be true. Do not shortcut the security review process.'
    );
  }

  const state = await detectCurrentState();

  if (!state.pr.exists || !state.pr.number) {
    throw new ValidationError('No PR found. Cannot complete security review.');
  }

  const totalIssues =
    input.high_priority_issues + input.medium_priority_issues + input.low_priority_issues;

  // Post PR comment with security review results
  const commentTitle =
    totalIssues > 0
      ? `Step ${STEP_SECURITY_REVIEW} (${STEP_NAMES[STEP_SECURITY_REVIEW]}) - Issues Found`
      : `Step ${STEP_SECURITY_REVIEW} (${STEP_NAMES[STEP_SECURITY_REVIEW]}) Complete - No Issues`;

  const commentBody =
    totalIssues > 0
      ? `**Command Executed:** \`${SECURITY_REVIEW_COMMAND}\`

**Security Issues Found:**
- High Priority: ${input.high_priority_issues}
- Medium Priority: ${input.medium_priority_issues}
- Low Priority: ${input.low_priority_issues}
- **Total: ${totalIssues}**

<details>
<summary>Full Security Review Output</summary>

${input.verbatim_response}

</details>

**Next Action:** Plan and implement security fixes for all issues, then call \`wiggum_complete_fix\`.`
      : `**Command Executed:** \`${SECURITY_REVIEW_COMMAND}\`

All security checks passed with no vulnerabilities identified.

**Security Aspects Covered:**
- Authentication and authorization
- Input validation and sanitization
- Secrets management
- Dependency vulnerabilities
- Security best practices`;

  // Update state
  let newState;
  if (totalIssues > 0) {
    // Issues found - increment iteration, do NOT mark step complete
    newState = {
      iteration: state.wiggum.iteration + 1,
      step: STEP_SECURITY_REVIEW,
      completedSteps: state.wiggum.completedSteps,
    };
  } else {
    // No issues - mark step complete
    newState = {
      iteration: state.wiggum.iteration,
      step: STEP_SECURITY_REVIEW,
      completedSteps: [...state.wiggum.completedSteps, STEP_SECURITY_REVIEW],
    };
  }

  // Post comment
  await postWiggumStateComment(state.pr.number, newState, commentTitle, commentBody);

  // Check iteration limit
  if (newState.iteration >= MAX_ITERATIONS) {
    const output = {
      current_step: STEP_NAMES[STEP_SECURITY_REVIEW],
      step_number: STEP_SECURITY_REVIEW,
      iteration_count: newState.iteration,
      instructions: `Maximum iteration limit (${MAX_ITERATIONS}) reached. Manual intervention required.`,
      steps_completed_by_tool: [
        'Executed security review',
        'Posted results to PR',
        'Updated state',
      ],
      context: {
        pr_number: state.pr.number,
        total_issues: totalIssues,
      },
    };
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }

  // If issues found, provide fix instructions
  if (totalIssues > 0) {
    const output = {
      current_step: STEP_NAMES[STEP_SECURITY_REVIEW],
      step_number: STEP_SECURITY_REVIEW,
      iteration_count: newState.iteration,
      instructions: `${totalIssues} security issue(s) found.

1. Use Task tool with subagent_type="Plan" and model="opus" to create security fix plan for ALL issues
2. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement security fixes
3. Execute /commit-merge-push slash command using SlashCommand tool
4. Call wiggum_complete_fix with fix_description`,
      steps_completed_by_tool: [
        'Executed security review',
        'Posted results to PR',
        'Incremented iteration',
      ],
      context: {
        pr_number: state.pr.number,
        total_issues: totalIssues,
      },
    };
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }

  // No issues - construct updated state and return next step instructions
  // Construct updated state from existing state + newState to avoid redundant API calls
  const updatedState = {
    ...state,
    wiggum: newState,
  };
  return await getNextStepInstructions(updatedState);
}
