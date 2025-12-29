/**
 * Shared constants for Wiggum MCP server
 */

import { ValidationError } from './utils/errors.js';
import { logger } from './utils/logger.js';

// Maximum characters to return in tool responses to stay within token limits
export const MAX_RESPONSE_LENGTH = 10000;
export const WORKFLOW_LOG_MAX_CHARS = 50000; // For complete error logs in automated workflows
export const WORKFLOW_MONITOR_TIMEOUT_MS = 600000; // 10 minutes for workflow/PR check monitoring

// Wiggum flow constants
export const DEFAULT_MAX_ITERATIONS = 10;
export const NEEDS_REVIEW_LABEL = 'needs review';
export const CODE_QUALITY_BOT_USERNAME = 'github-code-quality[bot]';

// Two-phase workflow constants
export type WiggumPhase = 'phase1' | 'phase2';

// Phase 1 step identifiers (pre-PR)
export const STEP_PHASE1_MONITOR_WORKFLOW = 'p1-1' as const;
export const STEP_PHASE1_PR_REVIEW = 'p1-2' as const;
export const STEP_PHASE1_SECURITY_REVIEW = 'p1-3' as const;
export const STEP_PHASE1_CREATE_PR = 'p1-4' as const;

// Phase 2 step identifiers (post-PR)
export const STEP_PHASE2_MONITOR_WORKFLOW = 'p2-1' as const;
export const STEP_PHASE2_MONITOR_CHECKS = 'p2-2' as const;
export const STEP_PHASE2_CODE_QUALITY = 'p2-3' as const;
export const STEP_PHASE2_PR_REVIEW = 'p2-4' as const;
export const STEP_PHASE2_SECURITY_REVIEW = 'p2-5' as const;
export const STEP_PHASE2_APPROVAL = 'approval' as const;

/**
 * Valid step identifiers in the Wiggum workflow
 * Using a discriminated union to enforce type safety and prevent invalid steps
 */
export type WiggumStep =
  | typeof STEP_PHASE1_MONITOR_WORKFLOW
  | typeof STEP_PHASE1_PR_REVIEW
  | typeof STEP_PHASE1_SECURITY_REVIEW
  | typeof STEP_PHASE1_CREATE_PR
  | typeof STEP_PHASE2_MONITOR_WORKFLOW
  | typeof STEP_PHASE2_MONITOR_CHECKS
  | typeof STEP_PHASE2_CODE_QUALITY
  | typeof STEP_PHASE2_PR_REVIEW
  | typeof STEP_PHASE2_SECURITY_REVIEW
  | typeof STEP_PHASE2_APPROVAL;

/**
 * Ordered list of steps in the Wiggum workflow
 * Used for step index calculations and filtering
 */
export const STEP_ORDER: readonly WiggumStep[] = [
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
] as const;

/**
 * Validates if a string is a valid WiggumStep
 * @param step - The step to validate
 * @returns true if the step is valid
 */
export function isValidStep(step: unknown): step is WiggumStep {
  return STEP_ORDER.includes(step as WiggumStep);
}

// Step names (human-readable)
export const STEP_NAMES: Record<WiggumStep, string> = {
  [STEP_PHASE1_MONITOR_WORKFLOW]: 'Phase 1: Monitor Workflow',
  [STEP_PHASE1_PR_REVIEW]: 'Phase 1: Code Review (Pre-PR)',
  [STEP_PHASE1_SECURITY_REVIEW]: 'Phase 1: Security Review (Pre-PR)',
  [STEP_PHASE1_CREATE_PR]: 'Phase 1: Create PR',
  [STEP_PHASE2_MONITOR_WORKFLOW]: 'Phase 2: Monitor Workflow',
  [STEP_PHASE2_MONITOR_CHECKS]: 'Phase 2: Monitor PR Checks',
  [STEP_PHASE2_CODE_QUALITY]: 'Phase 2: Address Code Quality Comments',
  [STEP_PHASE2_PR_REVIEW]: 'Phase 2: PR Review (Post-PR)',
  [STEP_PHASE2_SECURITY_REVIEW]: 'Phase 2: Security Review (Post-PR)',
  [STEP_PHASE2_APPROVAL]: 'Approval',
};

// Comment markers for state tracking
export const WIGGUM_STATE_MARKER = 'wiggum-state';
export const WIGGUM_COMMENT_PREFIX = '## Wiggum:';

// Phase-specific review commands
export const SECURITY_REVIEW_COMMAND = '/security-review' as const;

// Phase-specific PR review commands
export const PHASE1_PR_REVIEW_COMMAND = '/all-hands-review' as const;
export const PHASE2_PR_REVIEW_COMMAND = '/review' as const;

// PR check failure states (used for fail-fast logic)
export const FAILURE_STATES = ['FAILURE', 'ERROR'] as const;

/**
 * Generate comprehensive triage instructions for review issues
 *
 * Produces a structured multi-step workflow that guides the agent through triaging
 * review recommendations, separating in-scope fixes from out-of-scope tracking.
 *
 * **Workflow Phases:**
 *
 * 1. **Plan Mode Entry** - Uses EnterPlanMode tool to begin structured planning
 *
 * 2. **Triage Process:**
 *    - Fetches issue context via mcp__gh-issue__gh_get_issue_context
 *    - Evaluates each recommendation against in-scope criteria
 *    - IN SCOPE: Required for validating issue implementation, improves new work, covers new tests
 *    - OUT OF SCOPE: Different issue, general improvements, unchanged code
 *    - Handles ambiguous cases with AskUserQuestion and gh issue edit
 *    - Searches existing issues for out-of-scope tracking (gh issue list)
 *
 * 3. **Plan Structure:**
 *    - Section A: In-scope fixes (all severity levels)
 *    - Section B: Out-of-scope tracking with issue numbers and TODO locations
 *
 * 4. **Execution:**
 *    - Exit plan mode
 *    - Implement in-scope fixes with accept-edits subagent
 *    - Create/update out-of-scope issues in parallel
 *    - Add TODO comments linking to issues
 *    - Commit via /commit-merge-push
 *    - Report completion via wiggum_complete_fix
 *
 * **Validation:** Throws ValidationError if reviewType not 'PR'/'Security', issueNumber
 * not a positive integer, or totalIssues not a non-negative integer.
 *
 * @param issueNumber - GitHub issue number defining scope boundary (positive integer)
 * @param reviewType - Review category: 'PR' or 'Security'
 * @param totalIssues - Count of recommendations to triage (non-negative integer)
 * @returns Formatted multi-step triage workflow instructions
 * @throws {ValidationError} Invalid reviewType, issueNumber, or totalIssues
 */
export function generateTriageInstructions(
  issueNumber: number,
  reviewType: 'PR' | 'Security',
  totalIssues: number
): string {
  // Error IDs for triage instruction validation
  const ERROR_INVALID_REVIEW_TYPE = 'TRIAGE_INVALID_REVIEW_TYPE';
  const ERROR_INVALID_ISSUE_NUMBER = 'TRIAGE_INVALID_ISSUE_NUMBER';
  const ERROR_INVALID_TOTAL_ISSUES = 'TRIAGE_INVALID_TOTAL_ISSUES';

  // Validate reviewType: Must be exactly 'PR' or 'Security' (case-sensitive)
  // TypeScript type system should prevent this at compile time, but runtime check ensures safety
  // TODO(#416): Add examples to validation error messages
  if (reviewType !== 'PR' && reviewType !== 'Security') {
    throw new ValidationError(
      `[${ERROR_INVALID_REVIEW_TYPE}] Invalid reviewType: ${JSON.stringify(reviewType)}. Must be either 'PR' or 'Security'.`
    );
  }

  // Validate issueNumber: Must be positive integer
  // Note: Number.isInteger rejects Infinity, -Infinity, NaN, and decimals (no need for separate Number.isFinite check)
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new ValidationError(
      `[${ERROR_INVALID_ISSUE_NUMBER}] Invalid issueNumber: ${issueNumber}. Must be a positive integer.`
    );
  }

  // Validate totalIssues: Must be non-negative integer (0, 5, 42, etc.)
  if (!Number.isInteger(totalIssues) || totalIssues < 0) {
    throw new ValidationError(
      `[${ERROR_INVALID_TOTAL_ISSUES}] Invalid totalIssues: ${totalIssues}. Must be a non-negative integer.`
    );
  }

  logger.info('Generating triage instructions', {
    issueNumber,
    reviewType,
    totalIssues,
  });

  return `${totalIssues} ${reviewType.toLowerCase()} review issue(s) found. Proceeding to triage phase.

## Step 1: Enter Plan Mode

Call the EnterPlanMode tool to enter planning mode for the triage process.

## Step 2: In Plan Mode - Triage Recommendations

**Working on Issue:** #${issueNumber}

### 2a. Locate Review Results

Review output was written to temp file for token efficiency.

**File Pattern:** \`$(pwd)/tmp/wiggum/{agent-name}-{scope}-*.md\`

**To view if needed:**
\`\`\`bash
ls -t $(pwd)/tmp/wiggum/*-in-scope-*.md $(pwd)/tmp/wiggum/*-out-of-scope-*.md | head -1 | xargs cat
\`\`\`

### 2b. Fetch Issue Context
Use \`mcp__gh-issue__gh_get_issue_context\` for issue #${issueNumber}.

### 2c. Triage Each Recommendation

For EACH recommendation, determine if **IN SCOPE** or **OUT OF SCOPE**:

**IN SCOPE criteria (must meet at least one):**
- Required to successfully validate implementation of issue #${issueNumber}
- Improves quality of new implementation work specifically
- Required for test coverage of new implementation work

**OUT OF SCOPE criteria:**
- Related to a different issue
- General quality/testing improvements not specific to this implementation
- Recommendations about code not changed in this PR

### 2d. Handle Ambiguous Scope
If scope unclear for any recommendation:
1. Use AskUserQuestion to clarify scope
2. Update issue body with scope clarifications using \`gh issue edit\`

### 2e. Check Existing Issues for Out-of-Scope Items
For each OUT OF SCOPE recommendation:
1. Search existing issues: \`gh issue list -S "search terms" --json number,title,body\`
2. Note existing issue # OR plan to create new issue

### 2f. Write Plan with These Sections

**A. In-Scope Fixes** - All fixes for in-scope recommendations (ALL severities)

**B. Out-of-Scope Tracking** - For each out-of-scope item:
- Summary of recommendation
- Existing issue # OR "Create new issue with title: [title]"
- File/line to add TODO comment

### 2g. Exit Plan Mode
Call ExitPlanMode when plan is complete.

## Step 3: Execute Plan (After Exiting Plan Mode)

1. Use Task tool with subagent_type="accept-edits" to implement ALL in-scope fixes

2. For out-of-scope items (can run in parallel with subagent_type="general-purpose"):
   - Create new issues OR add comments to existing issues
   - Add TODO comments: \`// TODO(#NNN): [brief description]\`

3. Execute /commit-merge-push slash command

4. Call wiggum_complete_fix with:
   - fix_description: Description of in-scope fixes
   - out_of_scope_issues: Array of issue numbers (both new and existing)`;
}

/**
 * Generate instructions for tracking out-of-scope recommendations
 *
 * When a review completes with only out-of-scope recommendations (no in-scope issues),
 * the step is marked complete but we still need to track the out-of-scope items.
 *
 * @param issueNumber - GitHub issue number (optional - may be undefined)
 * @param reviewType - Review type label (e.g., "PR", "Security")
 * @param outOfScopeCount - Number of out-of-scope recommendations
 * @param outOfScopeFiles - Array of file paths containing out-of-scope results
 * @returns Instructions for tracking out-of-scope recommendations
 */
export function generateOutOfScopeTrackingInstructions(
  issueNumber: number | undefined,
  reviewType: string,
  outOfScopeCount: number,
  outOfScopeFiles: readonly string[]
): string {
  const fileList = outOfScopeFiles.map((f) => `- ${f}`).join('\n');

  return `${outOfScopeCount} out-of-scope ${reviewType.toLowerCase()} review recommendation(s) found.

The review step is **complete** (no in-scope issues require fixing), but these out-of-scope recommendations should be tracked for future work.

## Task: Track Out-of-Scope Recommendations

Launch a general-purpose agent to handle out-of-scope tracking:

\`\`\`
Task({
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: \`Track out-of-scope recommendations in GitHub issues.

**Out-of-Scope Result Files:**
${fileList}

**Your Tasks:**
1. Read ALL out-of-scope result files above
2. For each recommendation:
   - Search for existing issues: \\\`gh issue list -S "keywords" --json number,title,body\\\`
   - If matching issue exists: Add comment linking to ${issueNumber ? `issue #${issueNumber}` : 'this work'}
   - If no match: Create new issue with proper labels and context
3. Collect all issue numbers (both new and existing)
4. Report back with list of issue numbers

**Issue Creation Template:**
- Title: Concise description of recommendation
- Body: Context from review${issueNumber ? `, link to issue #${issueNumber}` : ''}
- Labels: "enhancement", "from-review", appropriate area labels
\`
})
\`\`\`

After the agent completes, the workflow will proceed to the next step automatically.`;
}

/**
 * Generate parallel fix instructions for scope-separated review results
 *
 * When using the new file-based scope-separated format (in_scope_result_files + out_of_scope_result_files),
 * triage has already been done by the review agents. We can launch TWO agents in PARALLEL:
 * 1. One to plan and fix in-scope issues
 * 2. One to track out-of-scope recommendations
 *
 * This is more efficient than the old sequential triage workflow.
 *
 * @param issueNumber - GitHub issue number
 * @param reviewType - Review type label (e.g., "PR", "Security")
 * @param inScopeCount - Number of in-scope issues (total issue count, not file count)
 * @param inScopeFiles - Array of result file paths containing in-scope results
 * @param outOfScopeCount - Number of out-of-scope recommendations (total issue count, not file count)
 * @param outOfScopeFiles - Array of result file paths containing out-of-scope results
 * @returns Instructions for parallel fix execution
 */
export function generateScopeSeparatedFixInstructions(
  issueNumber: number,
  reviewType: string,
  inScopeCount: number,
  inScopeFiles: readonly string[],
  outOfScopeCount: number,
  outOfScopeFiles: readonly string[]
): string {
  // TODO(#986): Consider deprecating unused parameters (issueNumber, inScopeFiles, outOfScopeFiles) in a future version bump
  // issueNumber, inScopeFiles, and outOfScopeFiles are kept in signature for backwards compatibility
  // but are no longer used since we switched to wiggum_list_issues workflow
  void issueNumber;
  void inScopeFiles;
  void outOfScopeFiles;

  // Build the instruction text
  let instructions = `${inScopeCount} in-scope ${reviewType.toLowerCase()} review issue(s) found.`;

  if (outOfScopeCount > 0) {
    instructions += ` Also found ${outOfScopeCount} out-of-scope recommendation(s) to track.`;
  }

  instructions += `

## Workflow: List Issues -> Launch Agents

**Step 1: Get Issue References**

Call \`wiggum_list_issues\` to get minimal issue references:

\`\`\`
wiggum_list_issues({ scope: 'all' })
\`\`\`

This returns issue IDs, titles, and counts WITHOUT full descriptions (saves tokens).

**Step 2: Create TODO List**

From the returned issue references, create a TODO list to track progress.

**Step 3: Launch Agents**

### For In-Scope Issues: RUN ONE AT A TIME (Sequential)

For EACH in-scope issue (one at a time, in order):

\`\`\`
Task({
  subagent_type: "unsupervised-implement",
  model: "opus",
  description: "Implement fix for issue {issue_id}",
  prompt: \`Implement fix for issue: {issue_id}

**Instructions:**
1. Call wiggum_get_issue({ id: "{issue_id}" }) to get full issue details
2. Implement the fix described in the issue
3. Return completion status

**IMPORTANT:** The agent will fetch full issue details using wiggum_get_issue.
Do not pass full details in this prompt - pass only the issue_id.
\`
})
\`\`\`

Wait for each agent to complete before starting the next one.

`;

  if (outOfScopeCount > 0) {
    instructions += `
### For Out-of-Scope Issues: RUN ALL IN PARALLEL

Launch ALL out-of-scope tracking agents IN PARALLEL (all in one message):

For EACH out-of-scope issue:

\`\`\`
Task({
  subagent_type: "out-of-scope-tracker",
  model: "sonnet",
  description: "Track out-of-scope issue {issue_id}",
  prompt: \`Track out-of-scope issue: {issue_id}

**Instructions:**
1. Call wiggum_get_issue({ id: "{issue_id}" }) to get full issue details
2. Follow the out-of-scope tracking workflow in your system prompt
3. Return completion status with issue numbers created/updated

**IMPORTANT:** The agent will fetch full issue details using wiggum_get_issue.
Do not pass full details in this prompt - pass only the issue_id.
\`
})
\`\`\`

**Launch all out-of-scope agents in parallel** by making multiple Task calls in a single message.

`;
  }

  instructions += `
## After All Agents Complete

1. Wait for ALL agents to finish (both in-scope sequential and out-of-scope parallel)
2. Run \`/commit-merge-push\` to commit and push ALL fixes
3. Call \`wiggum_complete_fix\` with:
   - \`fix_description\`: Summary of in-scope fixes
   - \`has_in_scope_fixes\`: true (we fixed ${inScopeCount} issue(s))
   - \`out_of_scope_issues\`: Array of issue numbers from out-of-scope trackers${outOfScopeCount === 0 ? ' (empty array if no out-of-scope)' : ''}
`;

  return instructions;
}

/**
 * Generate comprehensive triage instructions for workflow failures
 *
 * Produces a structured multi-step workflow that guides the agent through triaging
 * workflow/check failures, separating in-scope fixes from out-of-scope tracking.
 *
 * **Workflow Phases:**
 *
 * 1. **Plan Mode Entry** - Uses EnterPlanMode tool to begin structured planning
 *
 * 2. **Triage Process:**
 *    - Fetches issue context via mcp__gh-issue__gh_get_issue_context
 *    - Evaluates each failure against in-scope criteria
 *    - IN SCOPE: Tests for code changed in this PR, build failures in modified modules, linting/type errors in changed files
 *    - OUT OF SCOPE: Flaky tests, unrelated failures, infrastructure issues, pre-existing failures
 *    - Handles ambiguous cases with AskUserQuestion and gh issue edit
 *    - Searches existing issues for out-of-scope tracking (gh issue list)
 *
 * 3. **Plan Structure:**
 *    - Section A: In-scope fixes (all failures that must be fixed)
 *    - Section B: Out-of-scope with skip mechanism (how to skip + which issue)
 *
 * 4. **Execution:**
 *    - Exit plan mode
 *    - Implement in-scope fixes with accept-edits subagent
 *    - Skip out-of-scope tests/steps with appropriate mechanism
 *    - Create/update out-of-scope issues in parallel
 *    - Add TODO comments linking to issues
 *    - Commit via /commit-merge-push
 *    - Report completion via wiggum_complete_fix
 *
 * **Validation:** Throws ValidationError if failureType not 'Workflow'/'PR checks', or issueNumber
 * not a positive integer.
 *
 * @param issueNumber - GitHub issue number defining scope boundary (positive integer)
 * @param failureType - Failure category: 'Workflow' or 'PR checks'
 * @param failureDetails - Detailed failure information from gh_get_failure_details
 * @returns Formatted multi-step triage workflow instructions
 * @throws {ValidationError} Invalid failureType or issueNumber
 */
// TODO(#334): Add error boundary tests
export function generateWorkflowTriageInstructions(
  issueNumber: number,
  failureType: 'Workflow' | 'PR checks',
  failureDetails: string
): string {
  // Validate failureType: Must be exactly 'Workflow' or 'PR checks' (case-sensitive)
  // TypeScript type system should prevent this at compile time, but runtime check ensures safety
  if (failureType !== 'Workflow' && failureType !== 'PR checks') {
    throw new ValidationError(
      `Invalid failureType: ${JSON.stringify(failureType)}. Must be either 'Workflow' or 'PR checks'.`
    );
  }

  // Validate issueNumber: Must be positive integer (e.g., 123, not 0, -1, 123.5, Infinity, NaN)
  // Note: Number.isInteger returns false for Infinity, -Infinity, and NaN
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new ValidationError(`Invalid issueNumber: ${issueNumber}. Must be a positive integer.`);
  }

  logger.info('Generating workflow triage instructions', {
    issueNumber,
    failureType,
    failureDetailsLength: failureDetails.length,
  });

  return `${failureType} failed. Proceeding to triage phase.

## Step 1: Enter Plan Mode

Call the EnterPlanMode tool to enter planning mode for the triage process.

## Step 2: In Plan Mode - Triage Failures

**Working on Issue:** #${issueNumber}

### 2a. Fetch Issue Context
Use \`mcp__gh-issue__gh_get_issue_context\` for issue #${issueNumber}.

### 2b. Triage Each Failure

For EACH failure in the details below, determine if **IN SCOPE** or **OUT OF SCOPE**:

**IN SCOPE criteria (must meet at least one):**
- Tests validating code changed in this PR/implementation
- Build failures in modified modules (TypeScript/Go compilation errors)
- Linting/formatting errors in changed files
- Type checking errors in implementation

**OUT OF SCOPE criteria:**
- Flaky tests with intermittent failures (check for patterns in recent runs)
- Tests in unrelated modules (not modified by implementation)
- Pre-existing failing tests (compare with main branch: \`gh run list --branch main\`)
- Infrastructure issues (network, Docker, GitHub Actions runners)
- Deployment failures when implementation is pre-deployment

### 2c. Handle Ambiguous Scope
If scope unclear for any failure:
1. Use AskUserQuestion to clarify scope
2. Update issue body with scope clarifications using \`gh issue edit\`

### 2d. Check Existing Issues for Out-of-Scope Items
For each OUT OF SCOPE failure:
1. Search existing issues: \`gh issue list -S "flaky test name" --json number,title,body\`
2. Search for infrastructure issues: \`gh issue list -S "infrastructure failure type" --json number,title,body\`
3. Note existing issue # OR plan to create new issue

### 2e. Write Plan with These Sections

**A. In-Scope Fixes** - All failures that must be fixed to validate implementation

**B. Out-of-Scope with Skip Mechanism** - For each out-of-scope failure:
- Summary of failure
- Existing issue # OR "Create new issue with title: [title]"
- Skip mechanism to use:
  ${SKIP_MECHANISM_GUIDANCE}
- File/line to add TODO comment: \`// TODO(#NNN): [brief description]\`

### 2f. Exit Plan Mode
Call ExitPlanMode when plan is complete.

## Step 3: Execute Plan (After Exiting Plan Mode)

1. Use Task tool with subagent_type="accept-edits" to implement ALL in-scope fixes

2. For out-of-scope items:
   a. Skip tests/steps using planned mechanism:
      - Test framework: Add skip annotations (it.skip, t.Skip, @pytest.mark.skip)
      - CI step: Add conditional (if: false or label-based)
   b. Add TODO comment at skip location: \`// TODO(#NNN): [brief description]\`
   c. Create new issues OR add comments to existing issues (can run in parallel with subagent_type="general-purpose")

3. Execute /commit-merge-push slash command

4. Call wiggum_complete_fix with:
   - fix_description: Description of in-scope fixes
   - has_in_scope_fixes: true if any in-scope fixes made, false if all out-of-scope
   - out_of_scope_issues: Array of issue numbers (both new and existing)

**Failure Details:**
${failureDetails}`;
}

/**
 * Skip mechanism guidance for workflow failures
 * Provides framework-specific and CI-specific skip patterns
 */
// TODO(#334): Validate syntax correctness of skip examples
export const SKIP_MECHANISM_GUIDANCE = `
**Test Framework Skipping:**
- Jest/Vitest: \`it.skip('test name', () => {...})\` or \`describe.skip('suite', ...)\`
- Go: \`t.Skip("reason")\` at start of test function
- Python pytest: \`@pytest.mark.skip(reason="...")\` decorator

**CI Step Skipping:**
- Unconditional: \`if: false\` in workflow step
- Label-based: \`if: contains(github.event.pull_request.labels.*.name, 'enable-flaky-tests')\`
- Branch-based: \`if: github.ref == 'refs/heads/main'\`

**Always add TODO comment at skip location:** \`// TODO(#NNN): [brief reason]\`
`.trim();

/**
 * Generate user prompt instructions when iteration limit is reached
 *
 * Provides clear instructions and options when the workflow hits the iteration limit.
 * Allows users to manually approve an increase to continue work.
 *
 * @param state - Current WiggumState with iteration and limit information
 * @param currentLimit - Effective max iterations (custom or default)
 * @returns Formatted instructions for user with options to increase limit or intervene manually
 */
export function generateIterationLimitInstructions(
  state: import('./state/types.js').WiggumState,
  currentLimit: number
): string {
  return `**Iteration Limit Reached (${state.iteration}/${currentLimit})**

The workflow has reached the ${state.maxIterations ? 'custom' : 'default'} iteration limit.

**Current Situation:**
- Current iteration: ${state.iteration}
- Current limit: ${currentLimit}${state.maxIterations ? ' (custom)' : ' (default)'}
- Current step: ${STEP_NAMES[state.step]}
- Phase: ${state.phase === 'phase1' ? 'Phase 1 (Pre-PR)' : 'Phase 2 (Post-PR)'}

**Options:**

1. **Increase Iteration Limit** - Respond with new limit:
   "Increase iteration limit to [NUMBER]" (e.g., "Increase iteration limit to 15")

2. **Manual Intervention** - Fix issues manually and resume with wiggum_init

**If you approve an increase:**
- The workflow will continue from the current step with the new limit
- You'll need to call the completion tool with the maxIterations parameter`;
}
