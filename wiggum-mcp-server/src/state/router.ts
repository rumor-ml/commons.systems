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
import { logger } from '../utils/logger.js';
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
  WORKFLOW_MONITOR_TIMEOUT_MS,
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
  steps_completed_by_tool: string[];
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
  logger.debug('getNextStepInstructions', {
    prExists: state.pr.exists,
    prState: state.pr.exists ? state.pr.state : 'N/A',
    currentBranch: state.git.currentBranch,
    iteration: state.wiggum.iteration,
    completedSteps: state.wiggum.completedSteps,
  });

  // Step 0: Ensure OPEN PR exists (treat CLOSED/MERGED PRs as non-existent)
  // We need an OPEN PR to proceed with monitoring and reviews
  if (!state.pr.exists || (state.pr.exists && state.pr.state !== 'OPEN')) {
    logger.info('Routing to Step 0: Ensure PR', {
      prExists: state.pr.exists,
      prState: state.pr.exists ? state.pr.state : 'N/A',
    });
    return handleStepEnsurePR(state);
  }

  // After this point, PR is guaranteed to exist (type-safe assertion)
  const stateWithPR = state as CurrentStateWithPR;

  // Step 1: Monitor Workflow (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_MONITOR_WORKFLOW)) {
    logger.info('Routing to Step 1: Monitor Workflow', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handleStepMonitorWorkflow(stateWithPR);
  }

  // Step 1b: Monitor PR Checks (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_MONITOR_PR_CHECKS)) {
    logger.info('Routing to Step 1b: Monitor PR Checks', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handleStepMonitorPRChecks(stateWithPR);
  }

  // Step 2: Code Quality Comments (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_CODE_QUALITY)) {
    logger.info('Routing to Step 2: Code Quality', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handleStepCodeQuality(stateWithPR);
  }

  // Step 3: PR Review (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PR_REVIEW)) {
    logger.info('Routing to Step 3: PR Review', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return handleStepPRReview(stateWithPR);
  }

  // Step 4: Security Review (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_SECURITY_REVIEW)) {
    logger.info('Routing to Step 4: Security Review', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return handleStepSecurityReview(stateWithPR);
  }

  // Step 4b: Verify Reviews (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_VERIFY_REVIEWS)) {
    logger.info('Routing to Step 4b: Verify Reviews', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handleStepVerifyReviews(stateWithPR);
  }

  // All steps complete - proceed to approval
  logger.info('Routing to Approval', {
    prNumber: stateWithPR.pr.number,
    iteration: state.wiggum.iteration,
  });
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
    steps_completed_by_tool: [],
    context: {
      current_branch: state.git.currentBranch,
    },
  };

  // Check if on main branch
  if (state.git.isMainBranch) {
    output.instructions =
      'ERROR: Cannot create PR from main branch. Please switch to a feature branch first.';
    output.steps_completed_by_tool = ['Checked branch name'];
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      isError: true,
    };
  }

  // Check for uncommitted changes
  if (state.git.hasUncommittedChanges) {
    output.instructions =
      'Uncommitted changes detected. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_complete_pr_creation to create the PR.';
    output.steps_completed_by_tool = ['Checked for uncommitted changes'];
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  // Check if branch is pushed
  if (!state.git.isPushed) {
    output.instructions = `Branch not pushed to remote. Execute: git push -u origin ${state.git.currentBranch}`;
    output.steps_completed_by_tool = ['Checked push status'];
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  // PR doesn't exist - need to create it
  if (!state.pr.exists) {
    output.instructions = `**CRITICAL: Call wiggum_complete_pr_creation tool directly. DO NOT use gh pr create command.**

Call wiggum_complete_pr_creation with pr_description parameter describing the changes in this PR.

The tool will:
- Extract issue number from branch name (format: 123-feature-name)
- Create PR with "closes #<issue>" line + your description
- Mark step complete
- Return next step instructions

**Do not create the PR manually. Do not call gh pr create. The tool does everything.**

Continue by calling wiggum_complete_pr_creation.

**Call the tool ONCE. It will return instructions for the next step. Do not call it again.**`;

    output.steps_completed_by_tool = ['Validated branch name format', 'Checked for existing PR'];
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
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  // Call monitoring tool directly
  const result = await monitorRun(state.git.currentBranch, WORKFLOW_MONITOR_TIMEOUT_MS);

  if (result.success) {
    // Mark Step 1 complete
    const { postWiggumStateComment } = await import('./comments.js');
    const { detectCurrentState } = await import('./detector.js');

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

    const stepsCompleted = [
      'Monitored workflow run until completion',
      'Marked Step 1 complete',
      'Posted state comment to PR',
    ];

    // CONTINUE to Step 1b: Monitor PR checks
    // Check for uncommitted changes
    const updatedState = await detectCurrentState();
    if (updatedState.git.hasUncommittedChanges) {
      output.instructions =
        'Uncommitted changes detected. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
      output.steps_completed_by_tool = [...stepsCompleted, 'Checked for uncommitted changes'];
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }

    // Check if branch is pushed
    if (!updatedState.git.isPushed) {
      output.instructions =
        'Branch not pushed to remote. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
      output.steps_completed_by_tool = [...stepsCompleted, 'Checked push status'];
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }

    // Monitor PR checks
    const prChecksResult = await monitorPRChecks(state.pr.number, WORKFLOW_MONITOR_TIMEOUT_MS);

    if (!prChecksResult.success) {
      // PR checks failed - return fix instructions
      output.instructions = `PR checks failed. Follow these steps to fix:

1. Analyze the error details below (includes test failures, stack traces, file locations)
2. Use Task tool with subagent_type="Plan" and model="opus" to create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description

**Failure Details:**
${prChecksResult.failureDetails || prChecksResult.errorSummary || 'See PR checks for details'}`;
      output.steps_completed_by_tool = [
        ...stepsCompleted,
        'Checked for uncommitted changes',
        'Checked push status',
        'Monitored PR checks until first failure',
        'Retrieved complete failure details via gh_get_failure_details tool',
      ];
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }

    // PR checks succeeded - mark Step 1b complete
    const newState1b = {
      iteration: updatedState.wiggum.iteration,
      step: STEP_MONITOR_PR_CHECKS,
      completedSteps: [...updatedState.wiggum.completedSteps, STEP_MONITOR_PR_CHECKS],
    };

    await postWiggumStateComment(
      state.pr.number,
      newState1b,
      `${STEP_NAMES[STEP_MONITOR_PR_CHECKS]} - Complete`,
      'All PR checks passed successfully.'
    );

    stepsCompleted.push(
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored all PR checks until completion',
      'Marked Step 1b complete',
      'Posted state comment to PR'
    );

    // CONTINUE to Step 2: Fetch code quality comments and return next instructions
    const finalState = await detectCurrentState();
    return processCodeQualityAndReturnNextInstructions(
      finalState as CurrentStateWithPR,
      stepsCompleted
    );
  } else {
    // Return fix instructions
    output.instructions = `Workflow failed. Follow these steps to fix:

1. Analyze the error details below (includes test failures, stack traces, file locations)
2. Use Task tool with subagent_type="Plan" and model="opus" to create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description

**Failure Details:**
${result.failureDetails || result.errorSummary || 'See workflow logs for details'}`;
    output.steps_completed_by_tool = [
      'Monitored workflow run until first failure',
      'Retrieved complete failure details via gh_get_failure_details tool',
    ];
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
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  // Check for uncommitted changes
  if (state.git.hasUncommittedChanges) {
    output.instructions =
      'Uncommitted changes detected. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
    output.steps_completed_by_tool = ['Checked for uncommitted changes'];
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  // Check if branch is pushed
  if (!state.git.isPushed) {
    output.instructions =
      'Branch not pushed to remote. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
    output.steps_completed_by_tool = ['Checked push status'];
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
    };
  }

  // Call monitoring tool directly
  const result = await monitorPRChecks(state.pr.number, WORKFLOW_MONITOR_TIMEOUT_MS);

  if (result.success) {
    // Mark Step 1b complete
    const { postWiggumStateComment } = await import('./comments.js');
    const { detectCurrentState } = await import('./detector.js');

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

    const stepsCompleted = [
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored all PR checks until completion',
      'Marked Step 1b complete',
      'Posted state comment to PR',
    ];

    // CONTINUE to Step 2: Fetch code quality comments and return next instructions
    const updatedState = await detectCurrentState();
    return processCodeQualityAndReturnNextInstructions(
      updatedState as CurrentStateWithPR,
      stepsCompleted
    );
  } else {
    // Return fix instructions
    output.instructions = `PR checks failed. Follow these steps to fix:

1. Analyze the error details below (includes test failures, stack traces, file locations)
2. Use Task tool with subagent_type="Plan" and model="opus" to create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description

**Failure Details:**
${result.failureDetails || result.errorSummary || 'See PR checks for details'}`;
    output.steps_completed_by_tool = [
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored PR checks until first failure',
      'Retrieved complete failure details via gh_get_failure_details tool',
    ];
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

/**
 * Helper: Process Step 2 (Code Quality) and return appropriate next instructions
 *
 * This is called by:
 * - handleStepMonitorWorkflow() after Step 1+1b complete successfully
 * - handleStepMonitorPRChecks() after Step 1b completes successfully
 * - Direct routing to handleStepCodeQuality() (e.g., after fixes)
 */
async function processCodeQualityAndReturnNextInstructions(
  state: CurrentStateWithPR,
  stepsCompletedSoFar: string[]
): Promise<ToolResult> {
  // Fetch code quality bot comments
  const comments = await getPRReviewComments(state.pr.number, CODE_QUALITY_BOT_USERNAME);

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_CODE_QUALITY],
    step_number: STEP_CODE_QUALITY,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    steps_completed_by_tool: [...stepsCompletedSoFar],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  if (comments.length === 0) {
    // No comments - mark Step 2 complete and return Step 3 (PR Review) instructions
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

    output.steps_completed_by_tool.push(
      'Fetched code quality comments - none found',
      'Marked Step 2 complete'
    );

    // Return Step 3 (PR Review) instructions
    output.current_step = STEP_NAMES[STEP_PR_REVIEW];
    output.step_number = STEP_PR_REVIEW;
    output.instructions = `Execute ${PR_REVIEW_COMMAND} using SlashCommand tool (no arguments).

After all review agents complete:
1. Capture the complete verbatim response
2. Count issues by priority (high, medium, low)
3. Call wiggum_complete_pr_review with:
   - command_executed: true
   - verbatim_response: (full output)
   - high_priority_issues: (count)
   - medium_priority_issues: (count)
   - low_priority_issues: (count)`;
  } else {
    // Comments found - return code quality review instructions
    output.steps_completed_by_tool.push(`Fetched code quality comments - ${comments.length} found`);
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
 * Step 2: Code Quality Comments
 *
 * Delegates to helper function to ensure consistent behavior
 */
async function handleStepCodeQuality(state: CurrentStateWithPR): Promise<ToolResult> {
  return processCodeQualityAndReturnNextInstructions(state, []);
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
    steps_completed_by_tool: [],
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
    steps_completed_by_tool: [],
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
    steps_completed_by_tool: [
      'Checked for PR review command evidence in comments',
      'Checked for security review command evidence in comments',
    ],
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
    output.steps_completed_by_tool.push('Marked step complete', 'Posted state comment to PR');
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
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}
