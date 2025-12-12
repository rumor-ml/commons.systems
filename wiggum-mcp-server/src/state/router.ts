/**
 * Router: Determines next step instructions based on current state
 *
 * This module contains the routing logic that determines what action
 * should be taken next in the wiggum workflow. It's used by both
 * wiggum_init (at start) and completion tools (after each step).
 */

import { getPRReviewComments } from '../utils/gh-cli.js';
import { hasReviewCommandEvidence } from './comments.js';
import { monitorRun, monitorPRChecks } from '../utils/gh-workflow.js';
import {
  STEP_ENSURE_PR,
  STEP_MONITOR_WORKFLOW,
  STEP_MONITOR_PR_CHECKS,
  STEP_CODE_QUALITY,
  STEP_PR_REVIEW,
  STEP_SECURITY_REVIEW,
  STEP_VERIFY_REVIEWS,
  STEP_APPROVAL,
  STEP_NAMES,
  CODE_QUALITY_BOT_USERNAME,
  PR_REVIEW_COMMAND,
  SECURITY_REVIEW_COMMAND,
  NEEDS_REVIEW_LABEL,
} from '../constants.js';
import type { ToolResult } from '../types.js';
import type { CurrentState } from './types.js';

/**
 * Helper type for state where PR is guaranteed to exist
 * Used in handlers after Step 0
 */
type CurrentStateWithPR = CurrentState & {
  pr: {
    exists: true;
    number: number;
    title: string;
    url: string;
    labels: string[];
    headRefName: string;
    baseRefName: string;
  };
};

interface WiggumInstructions {
  current_step: string;
  step_number: string;
  iteration_count: number;
  instructions: string;
  pr_title?: string;
  pr_labels?: string[];
  closing_issue?: string;
  context: {
    pr_number?: number;
    current_branch?: string;
  };
}

/**
 * Determines next step instructions based on current state
 *
 * This is the core routing logic that decides what action should be
 * taken next in the workflow. Called by wiggum_init and completion tools.
 */
export async function getNextStepInstructions(state: CurrentState): Promise<ToolResult> {
  // Step 0: Ensure PR exists (only if PR doesn't exist)
  if (!state.pr.exists) {
    return handleStepEnsurePR(state);
  }

  // After this point, PR is guaranteed to exist (type-safe assertion)
  const stateWithPR = state as CurrentStateWithPR;

  // Step 1: Monitor Workflow (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_MONITOR_WORKFLOW)) {
    return await handleStepMonitorWorkflow(stateWithPR);
  }

  // Step 1b: Monitor PR Checks (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_MONITOR_PR_CHECKS)) {
    return await handleStepMonitorPRChecks(stateWithPR);
  }

  // Step 2: Code Quality Comments (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_CODE_QUALITY)) {
    return await handleStepCodeQuality(stateWithPR);
  }

  // Step 3: PR Review (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PR_REVIEW)) {
    return handleStepPRReview(stateWithPR);
  }

  // Step 4: Security Review (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_SECURITY_REVIEW)) {
    return handleStepSecurityReview(stateWithPR);
  }

  // Step 4b: Verify Reviews (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_VERIFY_REVIEWS)) {
    return await handleStepVerifyReviews(stateWithPR);
  }

  // All steps complete - proceed to approval
  return handleApproval(stateWithPR);
}

/**
 * Step 0: Ensure PR exists
 *
 * Only called when PR doesn't exist. Validates pre-conditions and provides
 * instructions for creating the PR.
 */
function handleStepEnsurePR(state: CurrentState): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_ENSURE_PR],
    step_number: STEP_ENSURE_PR,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    context: {
      current_branch: state.git.currentBranch,
    },
  };

  // Check if on main branch
  if (state.git.isMainBranch) {
    output.instructions =
      'ERROR: Cannot create PR from main branch. Please switch to a feature branch first.';
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      isError: true,
    };
  }

  // Check for uncommitted changes
  if (state.git.hasUncommittedChanges) {
    output.instructions =
      'Uncommitted changes detected. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_complete_pr_creation to create the PR.';
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  // Check if branch is pushed
  if (!state.git.isPushed) {
    output.instructions = `Branch not pushed to remote. Execute: git push -u origin ${state.git.currentBranch}`;
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  // PR doesn't exist - need to create it
  if (!state.pr.exists) {
    output.instructions = `Call wiggum_complete_pr_creation with pr_description parameter describing the changes in this PR.

The tool will:
- Extract issue number from branch name (format: 123-feature-name)
- Create PR with "closes #<issue>" line + your description
- Mark step complete
- Return next step instructions

Continue by calling wiggum_complete_pr_creation.`;

    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Step 1: Monitor Workflow
 */
async function handleStepMonitorWorkflow(state: CurrentStateWithPR): Promise<ToolResult> {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_MONITOR_WORKFLOW],
    step_number: STEP_MONITOR_WORKFLOW,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  // Call monitoring tool directly
  const result = await monitorRun(state.git.currentBranch);

  if (result.success) {
    // Mark step complete
    const { postWiggumStateComment } = await import('./comments.js');

    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_MONITOR_WORKFLOW,
      completedSteps: [...state.wiggum.completedSteps, STEP_MONITOR_WORKFLOW],
    };

    await postWiggumStateComment(
      state.pr.number,
      newState,
      `${STEP_NAMES[STEP_MONITOR_WORKFLOW]} - Complete`,
      'Workflow run completed successfully.'
    );

    output.instructions = 'Workflow monitoring complete. Proceeding to PR checks.';
  } else {
    // Return fix instructions
    output.instructions = `Workflow failed. Follow these steps to fix:

1. Analyze the error (details below)
2. Use Task tool with subagent_type="Plan" and model="opus" to create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description

Error details:
${result.errorSummary || 'See workflow logs for details'}`;
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Step 1b: Monitor PR Checks
 */
async function handleStepMonitorPRChecks(state: CurrentStateWithPR): Promise<ToolResult> {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_MONITOR_PR_CHECKS],
    step_number: STEP_MONITOR_PR_CHECKS,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  // Call monitoring tool directly
  const result = await monitorPRChecks(state.pr.number);

  if (result.success) {
    // Mark step complete
    const { postWiggumStateComment } = await import('./comments.js');

    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_MONITOR_PR_CHECKS,
      completedSteps: [...state.wiggum.completedSteps, STEP_MONITOR_PR_CHECKS],
    };

    await postWiggumStateComment(
      state.pr.number,
      newState,
      `${STEP_NAMES[STEP_MONITOR_PR_CHECKS]} - Complete`,
      'All PR checks passed successfully.'
    );

    output.instructions = 'PR checks monitoring complete. Proceeding to Code Quality review.';
  } else {
    // Return fix instructions
    output.instructions = `PR checks failed. Follow these steps to fix:

1. Analyze the error (details below)
2. Use Task tool with subagent_type="Plan" and model="opus" to create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description

Error details:
${result.errorSummary || 'See PR checks for details'}`;
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Step 2: Code Quality Comments
 */
async function handleStepCodeQuality(state: CurrentStateWithPR): Promise<ToolResult> {
  // Fetch code quality bot comments
  const comments = await getPRReviewComments(state.pr.number, CODE_QUALITY_BOT_USERNAME);

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_CODE_QUALITY],
    step_number: STEP_CODE_QUALITY,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  if (comments.length === 0) {
    // Mark step complete
    const { postWiggumStateComment } = await import('./comments.js');

    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_CODE_QUALITY,
      completedSteps: [...state.wiggum.completedSteps, STEP_CODE_QUALITY],
    };

    await postWiggumStateComment(
      state.pr.number,
      newState,
      `${STEP_NAMES[STEP_CODE_QUALITY]} - Complete`,
      'No code quality comments found. Step complete.'
    );

    output.instructions =
      'No code quality comments found. Step marked complete. Proceeding to PR Review.';
  } else {
    output.instructions = `${comments.length} code quality comment(s) from ${CODE_QUALITY_BOT_USERNAME} found.

IMPORTANT: These are automated suggestions and NOT authoritative. Evaluate critically.

1. Use Task tool with subagent_type="Plan" and model="opus" to:
   - Review all github-code-quality bot comments
   - Assess each recommendation for validity
   - Create remediation plan ONLY for sound recommendations
2. If valid issues identified:
   a. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fixes
   b. Execute /commit-merge-push slash command using SlashCommand tool
   c. Call wiggum_complete_fix with fix_description
3. If all comments are invalid/should be ignored:
   - Mark step complete and proceed to next step
   - Call wiggum_complete_fix with fix_description: "All code quality comments evaluated and ignored"`;
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Step 3: PR Review
 */
function handleStepPRReview(state: CurrentStateWithPR): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PR_REVIEW],
    step_number: STEP_PR_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `Execute ${PR_REVIEW_COMMAND} using SlashCommand tool (no arguments).

After all review agents complete:
1. Capture the complete verbatim response
2. Count issues by priority (high, medium, low)
3. Call wiggum_complete_pr_review with:
   - command_executed: true
   - verbatim_response: (full output)
   - high_priority_issues: (count)
   - medium_priority_issues: (count)
   - low_priority_issues: (count)`,
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Step 4: Security Review
 */
function handleStepSecurityReview(state: CurrentStateWithPR): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_SECURITY_REVIEW],
    step_number: STEP_SECURITY_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `Execute ${SECURITY_REVIEW_COMMAND} using SlashCommand tool (no arguments).

After security review completes:
1. Capture the complete verbatim response
2. Count issues by priority (high, medium, low)
3. Call wiggum_complete_security_review with:
   - command_executed: true
   - verbatim_response: (full output)
   - high_priority_issues: (count)
   - medium_priority_issues: (count)
   - low_priority_issues: (count)`,
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Step 4b: Verify Reviews
 */
async function handleStepVerifyReviews(state: CurrentStateWithPR): Promise<ToolResult> {
  const hasPRReview = await hasReviewCommandEvidence(state.pr.number, PR_REVIEW_COMMAND);
  const hasSecurityReview = await hasReviewCommandEvidence(
    state.pr.number,
    SECURITY_REVIEW_COMMAND
  );

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_VERIFY_REVIEWS],
    step_number: STEP_VERIFY_REVIEWS,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  if (!hasPRReview) {
    output.instructions = `Missing evidence of ${PR_REVIEW_COMMAND} execution in PR comments. Return to Step 3: execute ${PR_REVIEW_COMMAND} and call wiggum_complete_pr_review.`;
  } else if (!hasSecurityReview) {
    output.instructions = `Missing evidence of ${SECURITY_REVIEW_COMMAND} execution in PR comments. Return to Step 4: execute ${SECURITY_REVIEW_COMMAND} and call wiggum_complete_security_review.`;
  } else {
    // Both reviews verified - mark step complete
    const { postWiggumStateComment } = await import('./comments.js');

    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_VERIFY_REVIEWS,
      completedSteps: [...state.wiggum.completedSteps, STEP_VERIFY_REVIEWS],
    };

    await postWiggumStateComment(
      state.pr.number,
      newState,
      `${STEP_NAMES[STEP_VERIFY_REVIEWS]} - Complete`,
      `Both review commands have been verified in PR comments:
- ✅ ${PR_REVIEW_COMMAND}
- ✅ ${SECURITY_REVIEW_COMMAND}

**Next Action:** Proceeding to approval.`
    );

    output.instructions =
      'Both review commands verified and step marked complete. Proceeding to approval.';
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Approval
 */
function handleApproval(state: CurrentStateWithPR): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_APPROVAL],
    step_number: STEP_APPROVAL,
    iteration_count: state.wiggum.iteration,
    instructions: `All review steps complete with no issues!

Final actions:
1. Post comprehensive summary comment to PR #${state.pr.number} using gh pr comment
2. Remove "${NEEDS_REVIEW_LABEL}" label: gh pr edit ${state.pr.number} --remove-label "${NEEDS_REVIEW_LABEL}"
3. Exit with success message: "All reviews complete with no issues identified. PR is ready for human review."

**IMPORTANT**: ALL gh commands must use dangerouslyDisableSandbox: true per CLAUDE.md`,
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}
