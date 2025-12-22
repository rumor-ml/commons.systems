/**
 * Shared helper for PR review and security review completion tools
 *
 * This module extracts common logic from complete-pr-review.ts and
 * complete-security-review.ts to reduce duplication while preserving
 * the distinct behavior of each review type.
 */

import { detectCurrentState } from '../state/detector.js';
import {
  getNextStepInstructions,
  safePostStateComment,
  safePostIssueStateComment,
  type StateCommentResult,
} from '../state/router.js';
import { addToCompletedSteps, applyWiggumState } from '../state/state-utils.js';
import { MAX_ITERATIONS, STEP_NAMES, generateTriageInstructions } from '../constants.js';
import type { WiggumStep, WiggumPhase } from '../constants.js';
import { ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { logger } from '../utils/logger.js';
import type { CurrentState, WiggumState } from '../state/types.js';

/**
 * Configuration for a review type (PR or Security)
 */
// TODO: See issue #333 - Add runtime validation (Zod schemas) for ReviewConfig and ReviewCompletionInput types
export interface ReviewConfig {
  /** Step identifier for Phase 1 */
  phase1Step: WiggumStep;
  /** Step identifier for Phase 2 */
  phase2Step: WiggumStep;
  /** Command that was executed */
  commandName: string;
  /** Type label for logging and messages (e.g., "PR", "Security") */
  reviewTypeLabel: string;
  /** Issue type for messages (e.g., "issue(s)", "security issue(s)") */
  issueTypeLabel: string;
  /** Success message for when no issues found */
  successMessage: string;
}

/**
 * Input for review completion
 */
export interface ReviewCompletionInput {
  command_executed: boolean;
  verbatim_response: string;
  high_priority_issues: number;
  medium_priority_issues: number;
  low_priority_issues: number;
}

/**
 * Get the review step based on current phase
 */
function getReviewStep(phase: WiggumPhase, config: ReviewConfig): WiggumStep {
  return phase === 'phase1' ? config.phase1Step : config.phase2Step;
}

/**
 * Validate phase requirements (issue for phase1, PR for phase2)
 */
function validatePhaseRequirements(state: CurrentState, config: ReviewConfig): void {
  if (state.wiggum.phase === 'phase1' && (!state.issue.exists || !state.issue.number)) {
    // TODO: See issue #312 - Add Sentry error ID for tracking
    throw new ValidationError(
      `No issue found. Phase 1 ${config.reviewTypeLabel.toLowerCase()} review requires an issue number in the branch name.`
    );
  }

  if (state.wiggum.phase === 'phase2' && (!state.pr.exists || !state.pr.number)) {
    // TODO: See issue #312 - Add Sentry error ID for tracking
    throw new ValidationError(
      `No PR found. Cannot complete ${config.reviewTypeLabel.toLowerCase()} review.`
    );
  }
}

/**
 * Build comment content based on review results
 * TODO: See issue #334 - Add tests for comment content formatting
 */
function buildCommentContent(
  input: ReviewCompletionInput,
  reviewStep: WiggumStep,
  totalIssues: number,
  config: ReviewConfig
): { title: string; body: string } {
  const title =
    totalIssues > 0
      ? `Step ${reviewStep} (${STEP_NAMES[reviewStep]}) - Issues Found`
      : `Step ${reviewStep} (${STEP_NAMES[reviewStep]}) Complete - No Issues`;

  const body =
    totalIssues > 0
      ? `**Command Executed:** \`${config.commandName}\`

**${config.reviewTypeLabel} Issues Found:**
- High Priority: ${input.high_priority_issues}
- Medium Priority: ${input.medium_priority_issues}
- Low Priority: ${input.low_priority_issues}
- **Total: ${totalIssues}**

<details>
<summary>Full ${config.reviewTypeLabel} Review Output</summary>

${input.verbatim_response}

</details>

**Next Action:** Plan and implement ${config.reviewTypeLabel.toLowerCase()} fixes for all issues, then call \`wiggum_complete_fix\`.`
      : `**Command Executed:** \`${config.commandName}\`

${config.successMessage}`;

  return { title, body };
}

/**
 * Build new state based on review results
 */
function buildNewState(
  currentState: CurrentState,
  reviewStep: WiggumStep,
  hasIssues: boolean
): WiggumState {
  if (hasIssues) {
    return {
      iteration: currentState.wiggum.iteration + 1,
      step: reviewStep,
      completedSteps: currentState.wiggum.completedSteps,
      phase: currentState.wiggum.phase,
    };
  }

  return {
    iteration: currentState.wiggum.iteration,
    step: reviewStep,
    completedSteps: addToCompletedSteps(currentState.wiggum.completedSteps, reviewStep),
    phase: currentState.wiggum.phase,
  };
}

/**
 * Post state comment to issue (phase1) or PR (phase2)
 */
async function postStateComment(
  state: CurrentState,
  newState: {
    iteration: number;
    step: WiggumStep;
    completedSteps: WiggumStep[];
    phase: WiggumPhase;
  },
  title: string,
  body: string
): Promise<StateCommentResult> {
  if (state.wiggum.phase === 'phase1') {
    if (!state.issue.exists || !state.issue.number) {
      // TODO: See issue #312 - Add Sentry error ID for tracking
      throw new ValidationError(
        'Internal error: Phase 1 requires issue number, but validation passed with no issue'
      );
    }
    return await safePostIssueStateComment(
      state.issue.number,
      newState,
      title,
      body,
      newState.step
    );
  } else {
    if (!state.pr.exists || !state.pr.number) {
      // TODO: See issue #312 - Add Sentry error ID for tracking
      throw new ValidationError(
        'Internal error: Phase 2 requires PR number, but validation passed with no PR'
      );
    }
    return await safePostStateComment(
      state.pr.number,
      newState,
      title,
      body,
      newState.step
    );
  }
}

/**
 * Build iteration limit response
 */
function buildIterationLimitResponse(
  state: CurrentState,
  reviewStep: WiggumStep,
  totalIssues: number,
  newIteration: number
): ToolResult {
  const output = {
    current_step: STEP_NAMES[reviewStep],
    step_number: reviewStep,
    iteration_count: newIteration,
    instructions: `Maximum iteration limit (${MAX_ITERATIONS}) reached. Manual intervention required.`,
    steps_completed_by_tool: [
      'Executed review',
      state.wiggum.phase === 'phase1' ? 'Posted results to issue' : 'Posted results to PR',
      'Updated state',
    ],
    context: {
      pr_number: state.wiggum.phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
      issue_number:
        state.wiggum.phase === 'phase1' && state.issue.exists ? state.issue.number : undefined,
      total_issues: totalIssues,
    },
  };
  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Build triage/fix instructions response when issues are found
 */
function buildIssuesFoundResponse(
  state: CurrentState,
  reviewStep: WiggumStep,
  totalIssues: number,
  newIteration: number,
  config: ReviewConfig
): ToolResult {
  const issueNumber = state.issue.exists ? state.issue.number : undefined;

  if (issueNumber) {
    logger.info(
      `Providing triage instructions for ${config.reviewTypeLabel.toLowerCase()} review issues`,
      {
        phase: state.wiggum.phase,
        issueNumber,
        totalIssues,
        iteration: newIteration,
      }
    );
  } else {
    // TODO: See issue #314 - Add actionable error context when issueNumber is undefined
    logger.warn('Issue number undefined - using fallback fix instructions instead of triage', {
      phase: state.wiggum.phase,
      totalIssues,
      iteration: newIteration,
      issueExists: state.issue.exists,
      branchName: state.git.currentBranch,
    });
  }

  const reviewTypeForTriage = config.reviewTypeLabel === 'Security' ? 'Security' : 'PR';
  const fallbackInstructions = `${totalIssues} ${config.issueTypeLabel} found.

1. Use Task tool with subagent_type="Plan" and model="opus" to create ${config.reviewTypeLabel.toLowerCase()} fix plan for ALL issues
2. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement ${config.reviewTypeLabel.toLowerCase()} fixes
3. Execute /commit-merge-push slash command using SlashCommand tool
4. Call wiggum_complete_fix with fix_description`;

  const output = {
    current_step: STEP_NAMES[reviewStep],
    step_number: reviewStep,
    iteration_count: newIteration,
    instructions: issueNumber
      ? generateTriageInstructions(issueNumber, reviewTypeForTriage, totalIssues)
      : fallbackInstructions,
    steps_completed_by_tool: [
      `Executed ${config.reviewTypeLabel.toLowerCase()} review`,
      state.wiggum.phase === 'phase1' ? 'Posted results to issue' : 'Posted results to PR',
      'Incremented iteration',
    ],
    context: {
      pr_number: state.wiggum.phase === 'phase2' && state.pr.exists ? state.pr.number : undefined,
      issue_number: issueNumber,
      total_issues: totalIssues,
    },
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Complete a review (PR or Security) and update workflow state
 *
 * This is the shared implementation for both complete-pr-review and
 * complete-security-review tools. It handles:
 * - Command execution validation
 * - Phase requirements validation
 * - Comment posting to issue or PR
 * - State updates
 * - Iteration limit checking
 * - Triage instructions generation
 *
 * @param input - Review completion input with issue counts and response
 * @param config - Configuration for the specific review type
 * @returns Tool result with next step instructions
 */
export async function completeReview(
  input: ReviewCompletionInput,
  config: ReviewConfig
): Promise<ToolResult> {
  if (!input.command_executed) {
    // TODO: See issue #312 - Add Sentry error ID for tracking
    throw new ValidationError(
      `command_executed must be true. Do not shortcut the ${config.reviewTypeLabel.toLowerCase()} review process.`
    );
  }

  const state = await detectCurrentState();
  const reviewStep = getReviewStep(state.wiggum.phase, config);

  validatePhaseRequirements(state, config);

  const totalIssues =
    input.high_priority_issues + input.medium_priority_issues + input.low_priority_issues;

  const { title, body } = buildCommentContent(input, reviewStep, totalIssues, config);
  const hasIssues = totalIssues > 0;
  const newState = buildNewState(state, reviewStep, hasIssues);

  const result = await postStateComment(state, newState, title, body);

  if (!result.success) {
    logger.error('Review state comment failed - halting workflow', {
      reviewType: config.reviewTypeLabel,
      reviewStep,
      reason: result.reason,
      isTransient: result.isTransient,
      phase: state.wiggum.phase,
      prNumber: state.pr.exists ? state.pr.number : undefined,
      issueNumber: state.issue.exists ? state.issue.number : undefined,
      reviewResults: {
        high: input.high_priority_issues,
        medium: input.medium_priority_issues,
        low: input.low_priority_issues,
        total: totalIssues,
      },
    });

    const reviewResultsSummary = `**${config.reviewTypeLabel} Review Results (NOT persisted):**
- High Priority: ${input.high_priority_issues}
- Medium Priority: ${input.medium_priority_issues}
- Low Priority: ${input.low_priority_issues}
- **Total: ${totalIssues}**`;

    return {
      content: [{
        type: 'text',
        text: formatWiggumResponse({
          current_step: STEP_NAMES[reviewStep],
          step_number: reviewStep,
          iteration_count: newState.iteration,
          instructions: `ERROR: ${config.reviewTypeLabel} review completed successfully, but failed to post state comment due to ${result.reason}.

${reviewResultsSummary}

**IMPORTANT:** The review itself succeeded. You do NOT need to re-run the ${config.reviewTypeLabel.toLowerCase()} review.

**Why This Failed:**
The race condition fix (issue #388) requires posting review results to the ${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} as a state comment. This state persistence failed.

**Common Causes:**
- GitHub API rate limiting (HTTP 429)
- Network connectivity issues
- Temporary GitHub API unavailability
- ${state.wiggum.phase === 'phase1' ? 'Issue' : 'PR'} does not exist or was closed

**Retry Instructions:**
1. Check rate limits: \`gh api rate_limit\`
2. Verify network connectivity: \`curl -I https://api.github.com\`
3. Confirm the ${state.wiggum.phase === 'phase1' ? 'issue' : 'PR'} exists: \`gh ${state.wiggum.phase === 'phase1' ? 'issue' : 'pr'} view ${state.wiggum.phase === 'phase1' ? (state.issue.exists ? state.issue.number : '<issue-number>') : (state.pr.exists ? state.pr.number : '<pr-number>')}\`
4. Once resolved, retry this tool call with the SAME parameters

The workflow will resume from this step once the state comment posts successfully.`,
          steps_completed_by_tool: [
            `Executed ${config.reviewTypeLabel.toLowerCase()} review successfully`,
            'Attempted to post state comment',
            'Failed due to transient error - review results NOT persisted',
          ],
          context: {
            pr_number: state.pr.exists ? state.pr.number : undefined,
            issue_number: state.issue.exists ? state.issue.number : undefined,
            review_type: config.reviewTypeLabel,
            total_issues: totalIssues,
            high_priority_issues: input.high_priority_issues,
            medium_priority_issues: input.medium_priority_issues,
            low_priority_issues: input.low_priority_issues,
          },
        })
      }],
      isError: true,
    };
  }

  if (newState.iteration >= MAX_ITERATIONS) {
    return buildIterationLimitResponse(state, reviewStep, totalIssues, newState.iteration);
  }

  if (hasIssues) {
    return buildIssuesFoundResponse(state, reviewStep, totalIssues, newState.iteration, config);
  }

  // Reuse the newState we just posted to avoid race condition with GitHub API (issue #388)
  // TRADE-OFF: This avoids GitHub API eventual consistency issues but assumes no external
  // state changes have occurred (PR closed, commits added, issue modified). This is safe
  // during inline step transitions within the same tool call. For state staleness validation,
  // see issue #391.
  const updatedState = applyWiggumState(state, newState);
  return await getNextStepInstructions(updatedState);
}
