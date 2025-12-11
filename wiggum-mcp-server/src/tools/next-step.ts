/**
 * Tool: wiggum_next_step
 *
 * Primary orchestration tool. Analyzes current state and determines next action.
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { getPRReviewComments } from '../utils/gh-cli.js';
import { hasReviewCommandEvidence } from '../state/comments.js';
import {
  MAX_ITERATIONS,
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
import type { CurrentState } from '../state/types.js';

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

export const NextStepInputSchema = z.object({});

export type NextStepInput = z.infer<typeof NextStepInputSchema>;

interface NextStepOutput {
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
 * Determine the next step in the wiggum flow based on current state
 */
export async function nextStep(_input: NextStepInput): Promise<ToolResult> {
  const state = await detectCurrentState();

  // Check iteration limit
  if (state.wiggum.iteration >= MAX_ITERATIONS) {
    const output: NextStepOutput = {
      current_step: 'Iteration Limit Reached',
      step_number: 'max',
      iteration_count: state.wiggum.iteration,
      instructions: `Maximum iteration limit (${MAX_ITERATIONS}) reached. Manual intervention required.`,
      context: {
        pr_number: state.pr.exists ? state.pr.number : undefined,
        current_branch: state.git.currentBranch,
      },
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  // Step 0: Ensure PR exists (only if PR doesn't exist)
  if (!state.pr.exists) {
    return handleStepEnsurePR(state);
  }

  // After this point, PR is guaranteed to exist (type-safe assertion)
  const stateWithPR = state as CurrentStateWithPR;

  // Step 1: Monitor Workflow (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_MONITOR_WORKFLOW)) {
    return handleStepMonitorWorkflow(stateWithPR);
  }

  // Step 1b: Monitor PR Checks (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_MONITOR_PR_CHECKS)) {
    return handleStepMonitorPRChecks(stateWithPR);
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
  const output: NextStepOutput = {
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
      'Uncommitted changes detected. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_next_step again.';
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
    const branchName = state.git.currentBranch;
    const issueNum = branchName.split('-')[0];

    output.instructions = `Create PR using these steps:

CRITICAL: All git/gh commands must use dangerouslyDisableSandbox: true per CLAUDE.md

1. Get commit messages for PR body:
   \`\`\`
   git log main..HEAD --pretty=format:"- %s"
   \`\`\`
   Store output in variable 'commits'

2. Create PR body text:
   \`\`\`
   body="closes #${issueNum}

\${commits}"
   \`\`\`

3. Create PR:
   \`\`\`
   gh pr create --base main --label "${NEEDS_REVIEW_LABEL}" --title "${branchName}" --body "\${body}"
   \`\`\`

4. After PR is created successfully, call wiggum_next_step again to proceed.`;

    output.pr_title = branchName;
    output.pr_labels = [NEEDS_REVIEW_LABEL];
    output.closing_issue = issueNum;

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
function handleStepMonitorWorkflow(state: CurrentStateWithPR): ToolResult {
  const output: NextStepOutput = {
    current_step: STEP_NAMES[STEP_MONITOR_WORKFLOW],
    step_number: STEP_MONITOR_WORKFLOW,
    iteration_count: state.wiggum.iteration,
    instructions: `Call mcp__gh-workflow__gh_monitor_run MCP tool with branch: "${state.git.currentBranch}".

On SUCCESS: call wiggum_next_step to proceed.

On FAILURE:
1. Call mcp__gh-workflow__gh_get_failure_details with branch: "${state.git.currentBranch}" to get error summary
2. Use Task tool with subagent_type="Plan" and model="opus" to analyze the error details and create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description`,
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
 * Step 1b: Monitor PR Checks
 */
function handleStepMonitorPRChecks(state: CurrentStateWithPR): ToolResult {
  const output: NextStepOutput = {
    current_step: STEP_NAMES[STEP_MONITOR_PR_CHECKS],
    step_number: STEP_MONITOR_PR_CHECKS,
    iteration_count: state.wiggum.iteration,
    instructions: `Call mcp__gh-workflow__gh_monitor_pr_checks MCP tool with pr_number: ${state.pr.number}.

On SUCCESS (Overall Status: SUCCESS): call wiggum_next_step to proceed.

On ANY OTHER STATUS (FAILED, CONFLICTS, BLOCKED, MIXED, etc.):
1. Call mcp__gh-workflow__gh_get_failure_details with pr_number: ${state.pr.number} to get error details
2. Use Task tool with subagent_type="Plan" and model="opus" to analyze the error details and create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description`,
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
 * Step 2: Code Quality Comments
 */
async function handleStepCodeQuality(state: CurrentStateWithPR): Promise<ToolResult> {
  // Fetch code quality bot comments
  const comments = await getPRReviewComments(state.pr.number, CODE_QUALITY_BOT_USERNAME);

  const output: NextStepOutput = {
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
    output.instructions = 'No code quality comments found. Call wiggum_next_step to proceed.';
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
   Call wiggum_next_step to proceed`;
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Step 3: PR Review
 */
function handleStepPRReview(state: CurrentStateWithPR): ToolResult {
  const output: NextStepOutput = {
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
  const output: NextStepOutput = {
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

  const output: NextStepOutput = {
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
    const { postWiggumStateComment } = await import('../state/comments.js');

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
      'Both review commands verified and step marked complete. Call wiggum_next_step to proceed to approval.';
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Approval
 */
function handleApproval(state: CurrentStateWithPR): ToolResult {
  const output: NextStepOutput = {
    current_step: STEP_NAMES[STEP_APPROVAL],
    step_number: STEP_APPROVAL,
    iteration_count: state.wiggum.iteration,
    instructions: `All review steps complete with no issues!

Final actions:
1. Post comprehensive summary comment to PR #${state.pr.number} using gh pr comment
2. Approve PR using: gh pr review --approve
3. Exit with success message: "All reviews complete with no issues identified. PR approved."

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
