/**
 * Tool: wiggum_complete_pr_review
 *
 * Called after /pr-review-toolkit:review-pr to report results
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { postWiggumStateComment } from '../state/comments.js';
import { postWiggumStateIssueComment } from '../state/issue-comments.js';
import { getNextStepInstructions } from '../state/router.js';
import {
  MAX_ITERATIONS,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE2_PR_REVIEW,
  STEP_NAMES,
  PR_REVIEW_COMMAND,
  type WiggumStep,
  generateTriageInstructions,
} from '../constants.js';
import { ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { logger } from '../utils/logger.js';

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

/**
 * Complete PR review and update state
 */
export async function completePRReview(input: CompletePRReviewInput): Promise<ToolResult> {
  // Validate command was actually executed
  if (!input.command_executed) {
    throw new ValidationError('command_executed must be true. Do not shortcut the review process.');
  }

  const state = await detectCurrentState();

  // Determine which phase we're in
  const phase = state.wiggum.phase;
  const prReviewStep: WiggumStep =
    phase === 'phase1' ? STEP_PHASE1_PR_REVIEW : STEP_PHASE2_PR_REVIEW;

  // Phase 1 requires issue number, Phase 2 requires PR number
  if (phase === 'phase1' && (!state.issue.exists || !state.issue.number)) {
    throw new ValidationError(
      'No issue found. Phase 1 PR review requires an issue number in the branch name.'
    );
  }

  if (phase === 'phase2' && (!state.pr.exists || !state.pr.number)) {
    throw new ValidationError('No PR found. Cannot complete PR review.');
  }

  // TODO: See issue #293 - Add validation for negative/invalid issue counts
  const totalIssues =
    input.high_priority_issues + input.medium_priority_issues + input.low_priority_issues;

  // Post comment with review results
  const commentTitle =
    totalIssues > 0
      ? `Step ${prReviewStep} (${STEP_NAMES[prReviewStep]}) - Issues Found`
      : `Step ${prReviewStep} (${STEP_NAMES[prReviewStep]}) Complete - No Issues`;

  const commentBody =
    totalIssues > 0
      ? `**Command Executed:** \`${PR_REVIEW_COMMAND}\`

**Issues Found:**
- High Priority: ${input.high_priority_issues}
- Medium Priority: ${input.medium_priority_issues}
- Low Priority: ${input.low_priority_issues}
- **Total: ${totalIssues}**

<details>
<summary>Full Review Output</summary>

${input.verbatim_response}

</details>

**Next Action:** Plan and implement fixes for all issues, then call \`wiggum_complete_fix\`.`
      : `**Command Executed:** \`${PR_REVIEW_COMMAND}\`

All automated review checks passed with no concerns identified.

**Review Aspects Covered:**
- Code Quality: Project guidelines compliance (CLAUDE.md)
- Test Coverage: Behavioral coverage and edge cases
- Error Handling: Silent failure detection and logging
- Type Design: Type encapsulation and invariants
- Documentation: Comment accuracy and completeness
- Code Clarity: Simplification opportunities`;

  // Update state
  let newState;
  if (totalIssues > 0) {
    // Issues found - increment iteration, do NOT mark step complete
    newState = {
      iteration: state.wiggum.iteration + 1,
      step: prReviewStep,
      completedSteps: state.wiggum.completedSteps,
      phase: phase,
    };
  } else {
    // No issues - mark step complete
    newState = {
      iteration: state.wiggum.iteration,
      step: prReviewStep,
      completedSteps: [...state.wiggum.completedSteps, prReviewStep],
      phase: phase,
    };
  }

  // Post comment - to issue for Phase 1, to PR for Phase 2
  if (phase === 'phase1') {
    // Issue number is guaranteed to exist from validation above
    // TODO: See issue #295 - Enhance error messages with full diagnostic context
    if (!state.issue.exists || !state.issue.number) {
      throw new ValidationError(
        'Internal error: Phase 1 requires issue number, but validation passed with no issue'
      );
    }
    await postWiggumStateIssueComment(state.issue.number, newState, commentTitle, commentBody);
  } else {
    // Phase 2 - PR number is guaranteed to exist from validation above
    // TODO: See issue #295 - Enhance error messages with full diagnostic context
    if (!state.pr.exists || !state.pr.number) {
      throw new ValidationError(
        'Internal error: Phase 2 requires PR number, but validation passed with no PR'
      );
    }
    await postWiggumStateComment(state.pr.number, newState, commentTitle, commentBody);
  }

  // Check iteration limit
  if (newState.iteration >= MAX_ITERATIONS) {
    const output = {
      current_step: STEP_NAMES[prReviewStep],
      step_number: prReviewStep,
      iteration_count: newState.iteration,
      instructions: `Maximum iteration limit (${MAX_ITERATIONS}) reached. Manual intervention required.`,
      steps_completed_by_tool: [
        'Executed PR review',
        phase === 'phase1' ? 'Posted results to issue' : 'Posted results to PR',
        'Updated state',
      ],
      context: {
        pr_number: phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
        issue_number: phase === 'phase1' && state.issue.exists ? state.issue.number : undefined,
        total_issues: totalIssues,
      },
    };
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }

  // If issues found, provide triage instructions (when issue context is available)
  // or fallback fix instructions (when no issue number exists)
  if (totalIssues > 0) {
    // TODO: See issue #294 - Extract duplicated issue number resolution pattern
    const issueNumber = state.issue.exists && state.issue.number ? state.issue.number : undefined;

    // Log triage instruction decision
    if (issueNumber) {
      logger.info('Providing triage instructions for PR review issues', {
        phase,
        issueNumber,
        totalIssues,
        iteration: newState.iteration,
      });
    } else {
      logger.warn('Issue number undefined - using fallback fix instructions instead of triage', {
        phase,
        totalIssues,
        iteration: newState.iteration,
        issueExists: state.issue.exists,
        branchName: state.git.currentBranch,
      });
    }

    const output = {
      current_step: STEP_NAMES[prReviewStep],
      step_number: prReviewStep,
      iteration_count: newState.iteration,
      instructions: issueNumber
        ? generateTriageInstructions(issueNumber, 'PR', totalIssues)
        : // TODO: See issue #297 - Extract to helper function to reduce duplication
          `${totalIssues} issue(s) found in PR review.

1. Use Task tool with subagent_type="Plan" and model="opus" to create fix plan for ALL issues
2. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fixes
3. Execute /commit-merge-push slash command using SlashCommand tool
4. Call wiggum_complete_fix with fix_description`,
      steps_completed_by_tool: [
        'Executed PR review',
        phase === 'phase1' ? 'Posted results to issue' : 'Posted results to PR',
        'Incremented iteration',
      ],
      context: {
        pr_number: phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
        issue_number: issueNumber,
        total_issues: totalIssues,
      },
    };
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }

  // No issues - get updated state and return next step instructions
  const updatedState = await detectCurrentState();
  return await getNextStepInstructions(updatedState);
}
