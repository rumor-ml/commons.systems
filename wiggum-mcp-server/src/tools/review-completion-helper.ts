/**
 * Shared helper for PR review and security review completion tools
 *
 * This module extracts common logic from complete-pr-review.ts and
 * complete-security-review.ts to reduce duplication while preserving
 * the distinct behavior of each review type.
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { postWiggumStateComment } from '../state/comments.js';
import { postWiggumStateIssueComment } from '../state/issue-comments.js';
import { getNextStepInstructions } from '../state/router.js';
import { MAX_ITERATIONS, STEP_NAMES, generateTriageInstructions } from '../constants.js';
import type { WiggumStep, WiggumPhase } from '../constants.js';
import { ValidationError } from '../utils/errors.js';
import type { ToolResult } from '../types.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import { logger } from '../utils/logger.js';
import type { CurrentState } from '../state/types.js';

/**
 * Zod schema for ReviewConfig runtime validation
 */
export const ReviewConfigSchema = z.object({
  phase1Step: z.string(),
  phase2Step: z.string(),
  phase1Command: z.string(),
  phase2Command: z.string(),
  reviewTypeLabel: z.string(),
  issueTypeLabel: z.string(),
  successMessage: z.string(),
});

/**
 * Configuration for a review type (PR or Security)
 * TODO(#333, #363): Add readonly modifiers and runtime validation
 */
export interface ReviewConfig {
  /** Step identifier for Phase 1 */
  phase1Step: WiggumStep;
  /** Step identifier for Phase 2 */
  phase2Step: WiggumStep;
  /** Command for Phase 1 */
  phase1Command: string;
  /** Command for Phase 2 */
  phase2Command: string;
  /** Type label for logging and messages (e.g., "PR", "Security") */
  reviewTypeLabel: string;
  /** Issue type for messages (e.g., "issue(s)", "security issue(s)") */
  issueTypeLabel: string;
  /** Success message for when no issues found */
  successMessage: string;
}

/**
 * Zod schema for ReviewCompletionInput runtime validation
 */
export const ReviewCompletionInputSchema = z.object({
  command_executed: z.boolean(),
  verbatim_response: z.string(),
  high_priority_issues: z.number(),
  medium_priority_issues: z.number(),
  low_priority_issues: z.number(),
});

/**
 * Input for review completion
 * TODO(#333, #363): Add readonly modifiers and integer validation
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
    // TODO(#312): Add Sentry error ID for tracking
    throw new ValidationError(
      `No issue found. Phase 1 ${config.reviewTypeLabel.toLowerCase()} review requires an issue number in the branch name.`
    );
  }

  if (state.wiggum.phase === 'phase2' && (!state.pr.exists || !state.pr.number)) {
    // TODO(#312): Add Sentry error ID for tracking
    throw new ValidationError(
      `No PR found. Cannot complete ${config.reviewTypeLabel.toLowerCase()} review.`
    );
  }
}

/**
 * Build comment content based on review results
 * TODO(#334): Add test for phase-specific command selection
 */
function buildCommentContent(
  input: ReviewCompletionInput,
  reviewStep: WiggumStep,
  totalIssues: number,
  config: ReviewConfig,
  phase: WiggumPhase
): { title: string; body: string } {
  const command = phase === 'phase1' ? config.phase1Command : config.phase2Command;

  const title =
    totalIssues > 0
      ? `Step ${reviewStep} (${STEP_NAMES[reviewStep]}) - Issues Found`
      : `Step ${reviewStep} (${STEP_NAMES[reviewStep]}) Complete - No Issues`;

  const body =
    totalIssues > 0
      ? `**Command Executed:** \`${command}\`

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
      : `**Command Executed:** \`${command}\`

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
): { iteration: number; step: WiggumStep; completedSteps: WiggumStep[]; phase: WiggumPhase } {
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
    completedSteps: [...currentState.wiggum.completedSteps, reviewStep],
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
): Promise<void> {
  if (state.wiggum.phase === 'phase1') {
    if (!state.issue.exists || !state.issue.number) {
      // TODO(#312): Add Sentry error ID for tracking
      throw new ValidationError(
        'Internal error: Phase 1 requires issue number, but validation passed with no issue'
      );
    }
    await postWiggumStateIssueComment(state.issue.number, newState, title, body);
  } else {
    if (!state.pr.exists || !state.pr.number) {
      // TODO(#312): Add Sentry error ID for tracking
      throw new ValidationError(
        'Internal error: Phase 2 requires PR number, but validation passed with no PR'
      );
    }
    await postWiggumStateComment(state.pr.number, newState, title, body);
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

  if (!issueNumber) {
    // TODO(#312): Add Sentry error ID for tracking
    throw new ValidationError(
      `Issue number required for triage workflow but was undefined. This indicates a state detection issue. Branch: ${state.git.currentBranch}, Phase: ${state.wiggum.phase}`
    );
  }

  logger.info(
    `Providing triage instructions for ${config.reviewTypeLabel.toLowerCase()} review issues`,
    {
      phase: state.wiggum.phase,
      issueNumber,
      totalIssues,
      iteration: newIteration,
    }
  );

  const reviewTypeForTriage = config.reviewTypeLabel === 'Security' ? 'Security' : 'PR';

  const output = {
    current_step: STEP_NAMES[reviewStep],
    step_number: reviewStep,
    iteration_count: newIteration,
    instructions: generateTriageInstructions(issueNumber, reviewTypeForTriage, totalIssues),
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
    // TODO(#312): Add Sentry error ID for tracking
    throw new ValidationError(
      `command_executed must be true. Do not shortcut the ${config.reviewTypeLabel.toLowerCase()} review process.`
    );
  }

  const state = await detectCurrentState();
  const reviewStep = getReviewStep(state.wiggum.phase, config);

  validatePhaseRequirements(state, config);

  const totalIssues =
    input.high_priority_issues + input.medium_priority_issues + input.low_priority_issues;

  const { title, body } = buildCommentContent(
    input,
    reviewStep,
    totalIssues,
    config,
    state.wiggum.phase
  );
  const hasIssues = totalIssues > 0;
  const newState = buildNewState(state, reviewStep, hasIssues);

  await postStateComment(state, newState, title, body);

  if (newState.iteration >= MAX_ITERATIONS) {
    return buildIterationLimitResponse(state, reviewStep, totalIssues, newState.iteration);
  }

  if (hasIssues) {
    return buildIssuesFoundResponse(state, reviewStep, totalIssues, newState.iteration, config);
  }

  const updatedState = await detectCurrentState();
  return await getNextStepInstructions(updatedState);
}
