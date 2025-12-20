/**
 * Router: Determines next step instructions based on current state
 *
 * This module contains the routing logic that determines what action
 * should be taken next in the wiggum workflow. It's used by both
 * wiggum_init (at start) and completion tools (after each step).
 */

import { getPRReviewComments } from '../utils/gh-cli.js';
import { postWiggumStateComment } from './comments.js';
import { detectCurrentState } from './detector.js';
import { monitorRun, monitorPRChecks } from '../utils/gh-workflow.js';
import { logger } from '../utils/logger.js';
import { formatWiggumResponse } from '../utils/format-response.js';
import type { WiggumState } from './types.js';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE1_CREATE_PR,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_CHECKS,
  STEP_PHASE2_CODE_QUALITY,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
  STEP_PHASE2_APPROVAL,
  STEP_NAMES,
  CODE_QUALITY_BOT_USERNAME,
  PR_REVIEW_COMMAND,
  SECURITY_REVIEW_COMMAND,
  NEEDS_REVIEW_LABEL,
  WORKFLOW_MONITOR_TIMEOUT_MS,
} from '../constants.js';
import type { ToolResult } from '../types.js';
import type { CurrentState, PRExists } from './types.js';

/**
 * Helper type for state where PR is guaranteed to exist
 * Used in handlers after Step 0
 */
type CurrentStateWithPR = CurrentState & {
  pr: PRExists;
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
  warning?: string; // Non-fatal warnings to display to user
  context: {
    pr_number?: number;
    current_branch?: string;
  };
}

/**
 * Internal helper: Check for uncommitted changes and return early exit if found
 *
 * This is an internal utility function used by multiple step handlers
 * (handleStepMonitorWorkflow, handleStepMonitorPRChecks) to validate
 * git state before proceeding with monitoring operations.
 *
 * @internal
 * @param state - Current workflow state from detectCurrentState
 * @param output - WiggumInstructions object to populate with instructions
 * @param stepsCompleted - Array of steps completed so far to include in output
 * @returns ToolResult with commit instructions if changes found, null otherwise
 */
function checkUncommittedChanges(
  state: CurrentState,
  output: WiggumInstructions,
  stepsCompleted: string[]
): ToolResult | null {
  if (state.git.hasUncommittedChanges) {
    output.instructions =
      'Uncommitted changes detected. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
    output.steps_completed_by_tool = [...stepsCompleted, 'Checked for uncommitted changes'];
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }
  return null;
}

/**
 * Internal helper: Check if branch is pushed to remote and return early exit if not
 *
 * This is an internal utility function used by multiple step handlers
 * (handleStepMonitorWorkflow, handleStepMonitorPRChecks) to validate
 * git state before proceeding with monitoring operations.
 *
 * @internal
 * @param state - Current workflow state from detectCurrentState
 * @param output - WiggumInstructions object to populate with instructions
 * @param stepsCompleted - Array of steps completed so far to include in output
 * @returns ToolResult with push instructions if not pushed, null otherwise
 */
function checkBranchPushed(
  state: CurrentState,
  output: WiggumInstructions,
  stepsCompleted: string[]
): ToolResult | null {
  if (!state.git.isPushed) {
    output.instructions =
      'Branch not pushed to remote. Execute the `/commit-merge-push` slash command using SlashCommand tool, then call wiggum_init to restart workflow monitoring.';
    output.steps_completed_by_tool = [...stepsCompleted, 'Checked push status'];
    return {
      content: [{ type: 'text', text: formatWiggumResponse(output) }],
    };
  }
  return null;
}

/**
 * Safely post wiggum state comment with error handling
 *
 * Wraps postWiggumStateComment with consistent error handling and logging.
 * Failures to post state comments are logged but don't crash the workflow,
 * as state comments are for tracking and not critical to the workflow itself.
 *
 * @param prNumber - PR number to comment on
 * @param state - New wiggum state to save
 * @param title - Comment title
 * @param body - Comment body
 * @param step - Step identifier for logging context
 * @returns true if comment posted successfully, false otherwise
 */
async function safePostStateComment(
  prNumber: number,
  state: WiggumState,
  title: string,
  body: string,
  step: string
): Promise<boolean> {
  try {
    await postWiggumStateComment(prNumber, state, title, body);
    return true;
  } catch (commentError) {
    // Log but continue - state comment is for tracking, not critical path
    const errorMsg = commentError instanceof Error ? commentError.message : String(commentError);
    logger.warn('Failed to post state comment', {
      prNumber,
      step,
      title,
      error: errorMsg,
      recoveryNote: 'Workflow continues - missing state comment is recoverable',
    });
    return false;
  }
}

/**
 * Format fix instructions for workflow/check failures
 *
 * Generates standardized fix instructions for any workflow or check failure,
 * including the complete Plan -> Fix -> Commit -> Complete cycle.
 *
 * @param failureType - Type of failure (e.g., "Workflow", "PR checks")
 * @param failureDetails - Detailed error information from gh_get_failure_details
 * @param defaultMessage - Fallback message if no failure details available
 * @returns Formatted markdown instructions for fixing the failure
 */
function formatFixInstructions(
  failureType: string,
  failureDetails: string | undefined,
  defaultMessage: string
): string {
  return `${failureType} failed. Follow these steps to fix:

1. Analyze the error details below (includes test failures, stack traces, file locations)
2. Use Task tool with subagent_type="Plan" and model="opus" to create fix plan
3. Use Task tool with subagent_type="accept-edits" and model="sonnet" to implement fix
4. Execute /commit-merge-push slash command using SlashCommand tool
5. Call wiggum_complete_fix with fix_description

**Failure Details:**
${failureDetails || defaultMessage}`;
}

/**
 * Determines next step instructions based on current state
 *
 * This is the core routing logic that decides what action should be
 * taken next in the workflow. Called by wiggum_init and completion tools.
 */
export async function getNextStepInstructions(state: CurrentState): Promise<ToolResult> {
  logger.debug('getNextStepInstructions', {
    phase: state.wiggum.phase,
    prExists: state.pr.exists,
    prState: state.pr.exists ? state.pr.state : 'N/A',
    currentBranch: state.git.currentBranch,
    iteration: state.wiggum.iteration,
    completedSteps: state.wiggum.completedSteps,
  });

  // Route based on phase
  if (state.wiggum.phase === 'phase1') {
    return await getPhase1NextStep(state);
  } else {
    return await getPhase2NextStep(state);
  }
}

/**
 * Phase 1 routing: Pre-PR workflow
 * State is stored in issue comments
 */
async function getPhase1NextStep(state: CurrentState): Promise<ToolResult> {
  // Validate issue exists
  if (!state.issue.exists || !state.issue.number) {
    return {
      content: [
        {
          type: 'text',
          text: 'ERROR: Cannot run Phase 1 workflow: No issue number found in branch name. Expected format: "123-feature-name"',
        },
      ],
      isError: true,
    };
  }

  const issueNumber = state.issue.number;

  // Step p1-1: Monitor feature branch workflow
  if (!state.wiggum.completedSteps.includes(STEP_PHASE1_MONITOR_WORKFLOW)) {
    return await handlePhase1MonitorWorkflow(state, issueNumber);
  }

  // Step p1-2: PR Review
  if (!state.wiggum.completedSteps.includes(STEP_PHASE1_PR_REVIEW)) {
    return handlePhase1PRReview(state, issueNumber);
  }

  // Step p1-3: Security Review
  if (!state.wiggum.completedSteps.includes(STEP_PHASE1_SECURITY_REVIEW)) {
    return handlePhase1SecurityReview(state, issueNumber);
  }

  // Step p1-4: Create PR (all Phase 1 reviews passed!)
  return handlePhase1CreatePR(state, issueNumber);
}

/**
 * Phase 1 Step 1: Monitor Feature Branch Workflow
 */
async function handlePhase1MonitorWorkflow(
  state: CurrentState,
  issueNumber: number
): Promise<ToolResult> {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_MONITOR_WORKFLOW],
    step_number: STEP_PHASE1_MONITOR_WORKFLOW,
    iteration_count: state.wiggum.iteration,
    instructions: `## Step 1: Monitor Feature Branch Workflow

The feature branch workflow must complete successfully before proceeding to reviews.

**Instructions:**

1. Use the \`gh_monitor_run\` MCP tool to monitor the feature branch workflow:
   - Branch: ${state.git.currentBranch}
   - Timeout: 10 minutes

2. If the workflow succeeds:
   - Post completion comment to issue #${issueNumber}
   - Mark step p1-1 complete
   - Proceed to Step p1-2 (Code Review - Pre-PR)

3. If the workflow fails:
   - Get failure details using \`gh_get_failure_details\`
   - Post failure summary to issue #${issueNumber}
   - Use Task tool with subagent_type='Plan' to create fix plan
   - Use Task tool with subagent_type='accept-edits' to implement fixes
   - Execute /commit-merge-push
   - Call wiggum_complete_fix tool with fix description

The feature branch workflow runs tests and builds for changed modules only (no deployments).`,
    steps_completed_by_tool: [],
    context: {
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 1 Step 2: PR Review
 */
function handlePhase1PRReview(state: CurrentState, issueNumber: number): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_PR_REVIEW],
    step_number: STEP_PHASE1_PR_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `## Step 2: PR Review (Before PR Creation)

Execute comprehensive PR review on the current branch before creating the pull request.

**Instructions:**

1. Execute the PR review command:
   \`\`\`
   ${PR_REVIEW_COMMAND}
   \`\`\`

2. After the review completes, call the \`wiggum_complete_pr_review\` tool with:
   - command_executed: true
   - verbatim_response: (full review output)
   - high_priority_issues: (count)
   - medium_priority_issues: (count)
   - low_priority_issues: (count)

3. Results will be posted to issue #${issueNumber}

4. If issues are found:
   - You will be instructed to fix them (Plan + Fix cycle)
   - After fixes, workflow restarts from Step p1-1

5. If no issues:
   - Proceed to Step p1-3 (Security Review - Pre-PR)`,
    steps_completed_by_tool: [],
    context: {},
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 1 Step 3: Security Review
 */
function handlePhase1SecurityReview(state: CurrentState, issueNumber: number): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_SECURITY_REVIEW],
    step_number: STEP_PHASE1_SECURITY_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `## Step 3: Security Review (Before PR Creation)

Execute security review on the current branch before creating the pull request.

**Instructions:**

1. Execute the security review command:
   \`\`\`
   ${SECURITY_REVIEW_COMMAND}
   \`\`\`

2. After the review completes, call the \`wiggum_complete_security_review\` tool with:
   - command_executed: true
   - verbatim_response: (full review output)
   - high_priority_issues: (count)
   - medium_priority_issues: (count)
   - low_priority_issues: (count)

3. Results will be posted to issue #${issueNumber}

4. If issues are found:
   - You will be instructed to fix them (Plan + Fix cycle)
   - After fixes, workflow restarts from Step p1-1

5. If no issues:
   - Proceed to Step p1-4 (Create PR - All Pre-PR Reviews Passed!)`,
    steps_completed_by_tool: [],
    context: {},
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 1 Step 4: Create PR
 */
function handlePhase1CreatePR(state: CurrentState, issueNumber: number): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE1_CREATE_PR],
    step_number: STEP_PHASE1_CREATE_PR,
    iteration_count: state.wiggum.iteration,
    instructions: `## Step 4: Create Pull Request

Phase 1 complete! All reviews passed. Ready to create the pull request.

**Instructions:**

1. Provide a comprehensive PR description covering ALL commits on the branch:
   - Run: \`git log main..HEAD\` to see all commits
   - Summarize what was implemented/fixed

2. Call the \`wiggum_complete_pr_creation\` tool with:
   - pr_description: (comprehensive description of all changes)

3. The tool will:
   - Create the PR
   - Transition to Phase 2
   - Post initial Phase 2 state to the new PR
   - Begin Phase 2 workflow (PR workflow monitoring)

Phase 1 reviews passed - creating PR will begin Phase 2.`,
    steps_completed_by_tool: [],
    closing_issue: `#${issueNumber}`,
    context: {
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 2 routing: Post-PR workflow
 * State is stored in PR comments
 */
async function getPhase2NextStep(state: CurrentState): Promise<ToolResult> {
  // Ensure OPEN PR exists (treat CLOSED/MERGED PRs as non-existent)
  // We need an OPEN PR to proceed with monitoring and reviews
  if (!state.pr.exists || state.pr.state !== 'OPEN') {
    logger.error('Phase 2 workflow requires an open PR', {
      prExists: state.pr.exists,
      prState: state.pr.exists ? state.pr.state : 'N/A',
    });
    return {
      content: [
        {
          type: 'text',
          text: 'ERROR: Phase 2 workflow requires an open PR. PR does not exist or is not in OPEN state.',
        },
      ],
      isError: true,
    };
  }

  // After this point, PR is guaranteed to exist (type-safe via type guard)
  // TypeScript now knows state is CurrentStateWithPR
  const stateWithPR = state as CurrentStateWithPR;

  // Step p2-1: Monitor Workflow (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_MONITOR_WORKFLOW)) {
    logger.info('Routing to Phase 2 Step 1: Monitor Workflow', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handlePhase2MonitorWorkflow(stateWithPR);
  }

  // Step p2-2: Monitor PR Checks (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_MONITOR_CHECKS)) {
    logger.info('Routing to Phase 2 Step 2: Monitor PR Checks', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handlePhase2MonitorPRChecks(stateWithPR);
  }

  // Step p2-3: Code Quality Comments (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_CODE_QUALITY)) {
    logger.info('Routing to Phase 2 Step 3: Code Quality', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return await handlePhase2CodeQuality(stateWithPR);
  }

  // Step p2-4: PR Review (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_PR_REVIEW)) {
    logger.info('Routing to Phase 2 Step 4: PR Review', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return handlePhase2PRReview(stateWithPR);
  }

  // Step p2-5: Security Review (if not completed)
  if (!state.wiggum.completedSteps.includes(STEP_PHASE2_SECURITY_REVIEW)) {
    logger.info('Routing to Phase 2 Step 5: Security Review', {
      prNumber: stateWithPR.pr.number,
      iteration: state.wiggum.iteration,
    });
    return handlePhase2SecurityReview(stateWithPR);
  }

  // All steps complete - proceed to approval
  logger.info('Routing to Approval', {
    prNumber: stateWithPR.pr.number,
    iteration: state.wiggum.iteration,
  });
  return handleApproval(stateWithPR);
}

/**
 * Phase 2 Step 1: Monitor Workflow (also completes Step 2 when successful)
 *
 * This handler completes BOTH Step p2-1 (workflow monitoring) AND Step p2-2 (PR checks)
 * in a single function call when successful:
 *
 * 1. Monitors workflow run - marks Step p2-1 complete on success
 * 2. If Step p2-1 passes, continues inline to monitor PR checks
 * 3. If Step p2-2 passes, marks Step p2-2 complete and continues to Step p2-3
 *
 * This combined execution is an optimization to avoid returning to the agent
 * between Step p2-1 and Step p2-2 when both are expected to pass together.
 *
 * When called standalone after fixes (via handlePhase2MonitorPRChecks), only
 * Step p2-2 is executed since Step p2-1 is already in completedSteps.
 */
async function handlePhase2MonitorWorkflow(state: CurrentStateWithPR): Promise<ToolResult> {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_MONITOR_WORKFLOW],
    step_number: STEP_PHASE2_MONITOR_WORKFLOW,
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
    // Mark Step p2-1 complete
    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE2_MONITOR_WORKFLOW,
      completedSteps: [...state.wiggum.completedSteps, STEP_PHASE2_MONITOR_WORKFLOW],
      phase: 'phase2' as const,
    };

    await safePostStateComment(
      state.pr.number,
      newState,
      `${STEP_NAMES[STEP_PHASE2_MONITOR_WORKFLOW]} - Complete`,
      'Workflow run completed successfully.',
      STEP_PHASE2_MONITOR_WORKFLOW
    );

    const stepsCompleted = [
      'Monitored workflow run until completion',
      'Marked Step p2-1 complete',
      'Posted state comment to PR',
    ];

    // CONTINUE to Step p2-2: Monitor PR checks (within same function call)
    // stepsCompletedSoFar starts with Step p2-1 completion entries
    // Check for uncommitted changes before proceeding
    const updatedState = await detectCurrentState();

    const uncommittedCheck = checkUncommittedChanges(updatedState, output, stepsCompleted);
    if (uncommittedCheck) return uncommittedCheck;

    const pushCheck = checkBranchPushed(updatedState, output, stepsCompleted);
    if (pushCheck) return pushCheck;

    // Monitor PR checks
    const prChecksResult = await monitorPRChecks(state.pr.number, WORKFLOW_MONITOR_TIMEOUT_MS);

    if (!prChecksResult.success) {
      // PR checks failed - return fix instructions
      output.instructions = formatFixInstructions(
        'PR checks',
        prChecksResult.failureDetails || prChecksResult.errorSummary,
        'See PR checks for details'
      );
      output.steps_completed_by_tool = [
        ...stepsCompleted,
        'Checked for uncommitted changes',
        'Checked push status',
        'Monitored PR checks until first failure',
        'Retrieved complete failure details via gh_get_failure_details tool',
      ];
      return {
        content: [{ type: 'text', text: formatWiggumResponse(output) }],
      };
    }

    // PR checks succeeded - mark Step p2-2 complete
    const newState2 = {
      iteration: updatedState.wiggum.iteration,
      step: STEP_PHASE2_MONITOR_CHECKS,
      completedSteps: [...updatedState.wiggum.completedSteps, STEP_PHASE2_MONITOR_CHECKS],
      phase: 'phase2' as const,
    };

    await safePostStateComment(
      state.pr.number,
      newState2,
      `${STEP_NAMES[STEP_PHASE2_MONITOR_CHECKS]} - Complete`,
      'All PR checks passed successfully.',
      STEP_PHASE2_MONITOR_CHECKS
    );

    stepsCompleted.push(
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored all PR checks until completion',
      'Marked Step p2-2 complete',
      'Posted state comment to PR'
    );

    // CONTINUE to Step p2-3: Code Quality
    // This path is reached when Step p2-1 + Step p2-2 complete together in one function call.
    // stepsCompletedSoFar contains entries for BOTH Step p2-1 and Step p2-2 completion.
    // Fetch code quality bot comments and determine next action
    const finalState = await detectCurrentState();
    return processPhase2CodeQualityAndReturnNextInstructions(
      finalState as CurrentStateWithPR,
      stepsCompleted
    );
  } else {
    // Return fix instructions
    output.instructions = formatFixInstructions(
      'Workflow',
      result.failureDetails || result.errorSummary,
      'See workflow logs for details'
    );
    output.steps_completed_by_tool = [
      'Monitored workflow run until first failure',
      'Retrieved complete failure details via gh_get_failure_details tool',
    ];
  }

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 2 Step 2: Monitor PR Checks
 */
async function handlePhase2MonitorPRChecks(state: CurrentStateWithPR): Promise<ToolResult> {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_MONITOR_CHECKS],
    step_number: STEP_PHASE2_MONITOR_CHECKS,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  const uncommittedCheck = checkUncommittedChanges(state, output, []);
  if (uncommittedCheck) return uncommittedCheck;

  const pushCheck = checkBranchPushed(state, output, []);
  if (pushCheck) return pushCheck;

  // Call monitoring tool directly
  const result = await monitorPRChecks(state.pr.number, WORKFLOW_MONITOR_TIMEOUT_MS);

  if (result.success) {
    // Mark Step p2-2 complete
    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE2_MONITOR_CHECKS,
      completedSteps: [...state.wiggum.completedSteps, STEP_PHASE2_MONITOR_CHECKS],
      phase: 'phase2' as const,
    };

    await safePostStateComment(
      state.pr.number,
      newState,
      `${STEP_NAMES[STEP_PHASE2_MONITOR_CHECKS]} - Complete`,
      'All PR checks passed successfully.',
      STEP_PHASE2_MONITOR_CHECKS
    );

    const stepsCompleted = [
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored all PR checks until completion',
      'Marked Step p2-2 complete',
      'Posted state comment to PR',
    ];

    // CONTINUE to Step p2-3: Code Quality (Step p2-2 standalone path)
    // This path is reached when Step p2-1 was already complete (e.g., after re-verification).
    // stepsCompletedSoFar contains ONLY Step p2-2 completion entries (not Step p2-1).
    // Used after fixes when workflow monitoring already passed in a prior iteration.
    const updatedState = await detectCurrentState();
    return processPhase2CodeQualityAndReturnNextInstructions(
      updatedState as CurrentStateWithPR,
      stepsCompleted
    );
  } else {
    // Return fix instructions
    output.instructions = formatFixInstructions(
      'PR checks',
      result.failureDetails || result.errorSummary,
      'See PR checks for details'
    );
    output.steps_completed_by_tool = [
      'Checked for uncommitted changes',
      'Checked push status',
      'Monitored PR checks until first failure',
      'Retrieved complete failure details via gh_get_failure_details tool',
    ];
  }

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Helper: Process Phase 2 Step 3 (Code Quality) and return appropriate next instructions
 *
 * This is called by:
 * - handlePhase2MonitorWorkflow() after Step p2-1+p2-2 complete successfully
 * - handlePhase2MonitorPRChecks() after Step p2-2 completes successfully
 * - Direct routing to handlePhase2CodeQuality() (e.g., after fixes)
 */
async function processPhase2CodeQualityAndReturnNextInstructions(
  state: CurrentStateWithPR,
  stepsCompletedSoFar: string[]
): Promise<ToolResult> {
  // Fetch code quality bot comments
  const comments = await getPRReviewComments(state.pr.number, CODE_QUALITY_BOT_USERNAME);

  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_CODE_QUALITY],
    step_number: STEP_PHASE2_CODE_QUALITY,
    iteration_count: state.wiggum.iteration,
    instructions: '',
    steps_completed_by_tool: [...stepsCompletedSoFar],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  if (comments.length === 0) {
    // No comments - mark Step p2-3 complete and return Step p2-4 (PR Review) instructions
    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE2_CODE_QUALITY,
      completedSteps: [...state.wiggum.completedSteps, STEP_PHASE2_CODE_QUALITY],
      phase: 'phase2' as const,
    };

    await safePostStateComment(
      state.pr.number,
      newState,
      `${STEP_NAMES[STEP_PHASE2_CODE_QUALITY]} - Complete`,
      'No code quality comments found. Step complete.',
      STEP_PHASE2_CODE_QUALITY
    );

    output.steps_completed_by_tool.push(
      'Fetched code quality comments - none found',
      'Marked Step p2-3 complete'
    );

    // Return Step p2-4 (PR Review) instructions
    output.current_step = STEP_NAMES[STEP_PHASE2_PR_REVIEW];
    output.step_number = STEP_PHASE2_PR_REVIEW;
    output.instructions = `IMPORTANT: The review must cover ALL changes from this branch, not just recent commits.
Review all commits: git log main..HEAD --oneline

Execute ${PR_REVIEW_COMMAND} using SlashCommand tool (no arguments).

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
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 2 Step 3: Code Quality Comments
 *
 * Delegates to helper function to ensure consistent behavior
 */
async function handlePhase2CodeQuality(state: CurrentStateWithPR): Promise<ToolResult> {
  return processPhase2CodeQualityAndReturnNextInstructions(state, []);
}

/**
 * Phase 2 Step 4: PR Review
 */
function handlePhase2PRReview(state: CurrentStateWithPR): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_PR_REVIEW],
    step_number: STEP_PHASE2_PR_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `IMPORTANT: The review must cover ALL changes from this branch, not just recent commits.
Review all commits: git log main..HEAD --oneline

Execute ${PR_REVIEW_COMMAND} using SlashCommand tool (no arguments).

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
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Phase 2 Step 5: Security Review
 */
function handlePhase2SecurityReview(state: CurrentStateWithPR): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_SECURITY_REVIEW],
    step_number: STEP_PHASE2_SECURITY_REVIEW,
    iteration_count: state.wiggum.iteration,
    instructions: `IMPORTANT: The review must cover ALL changes from this branch, not just recent commits.
Review all commits: git log main..HEAD --oneline

Execute ${SECURITY_REVIEW_COMMAND} using SlashCommand tool (no arguments).

After security review completes:

1. Capture the complete verbatim response
2. Count issues by priority (high, medium, low)
3. Call **wiggum_complete_security_review** with:
   - command_executed: true
   - verbatim_response: (full output)
   - high_priority_issues: (count)
   - medium_priority_issues: (count)
   - low_priority_issues: (count)

**IMPORTANT:** Call wiggum_complete_**security**_review (NOT pr_review).
This tool posts results and returns next step instructions.`,
    steps_completed_by_tool: [],
    context: {
      pr_number: state.pr.number,
      current_branch: state.git.currentBranch,
    },
  };

  return {
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Approval (Phase 2 final step)
 */
function handleApproval(state: CurrentStateWithPR): ToolResult {
  const output: WiggumInstructions = {
    current_step: STEP_NAMES[STEP_PHASE2_APPROVAL],
    step_number: STEP_PHASE2_APPROVAL,
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
    content: [{ type: 'text', text: formatWiggumResponse(output) }],
  };
}

/**
 * Type guard to check if state has an existing PR
 * Narrows CurrentState to CurrentStateWithPR
 */
function hasExistingPR(state: CurrentState): state is CurrentStateWithPR {
  return state.pr.exists && state.pr.state === 'OPEN';
}

/**
 * Export internal functions for testing
 * @internal
 */
export const _testExports = {
  hasExistingPR,
  checkUncommittedChanges,
  checkBranchPushed,
  formatFixInstructions,
};
