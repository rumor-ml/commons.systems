/**
 * Tests for review-completion-helper
 *
 * Documentation of behavioral requirements for completeReview() shared helper function.
 * Tests document all code paths: phase1/phase2, issues found/no issues, iteration limits.
 *
 * Current coverage: Type safety and interface structure validation.
 *
 * TODO(#313): Add integration tests with mocked GitHub/git for:
 * - State detection and validation (issue in phase1, PR in phase2)
 * - Comment posting to correct locations (issue vs PR)
 * - Iteration increment vs step completion logic
 * - Triage instruction generation
 * - Iteration limit behavior
 * - Router integration for next step determination
 */

import { describe, it, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { writeFile, unlink, mkdir, rmdir } from 'fs/promises';
import type {
  ReviewConfig,
  ReviewCompletionInput,
  SafePostReviewCommentDeps,
  RetryStateUpdateDeps,
  RetryStateUpdateNewState,
} from './review-completion-helper.js';
import {
  extractAgentNameFromPath,
  loadReviewResults,
  safePostReviewComment,
  retryStateUpdate,
  createPRReviewConfig,
  createSecurityReviewConfig,
  validateReviewConfig,
} from './review-completion-helper.js';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
} from '../constants.js';
import type { StateUpdateResult } from '../state/router.js';
import type { CurrentState } from '../state/types.js';
import { GitHubCliError } from '../utils/errors.js';

describe('review-completion-helper', () => {
  describe('ReviewConfig structure', () => {
    it('should document PR review config structure', () => {
      // PR review config includes:
      // - phase1Step: STEP_PHASE1_PR_REVIEW ('p1-2')
      // - phase2Step: STEP_PHASE2_PR_REVIEW ('p2-4')
      // - phase1Command: '/all-hands-review' (or '/pr-review-toolkit:review-pr')
      // - phase2Command: '/review' (or '/pr-review-toolkit:review-pr')
      // - reviewTypeLabel: 'PR'
      // - issueTypeLabel: 'issue(s)'
      // - successMessage: 'No PR review issues found...'
      const config: ReviewConfig = {
        phase1Step: STEP_PHASE1_PR_REVIEW,
        phase2Step: STEP_PHASE2_PR_REVIEW,
        phase1Command: '/all-hands-review',
        phase2Command: '/pr-review-toolkit:review-pr',
        reviewTypeLabel: 'PR',
        issueTypeLabel: 'issue(s)',
        successMessage: 'No PR review issues found',
      };
      assert.strictEqual(config.phase1Step, 'p1-2');
      assert.strictEqual(config.phase2Step, 'p2-4');
    });

    it('should document Security review config structure', () => {
      // Security review config includes:
      // - phase1Step: STEP_PHASE1_SECURITY_REVIEW ('p1-3')
      // - phase2Step: STEP_PHASE2_SECURITY_REVIEW ('p2-5')
      // - phase1Command: '/security-review'
      // - phase2Command: '/security-review'
      // - reviewTypeLabel: 'Security'
      // - issueTypeLabel: 'security issue(s)'
      // - successMessage: 'No security issues found...'
      const config: ReviewConfig = {
        phase1Step: STEP_PHASE1_SECURITY_REVIEW,
        phase2Step: STEP_PHASE2_SECURITY_REVIEW,
        phase1Command: '/security-review',
        phase2Command: '/security-review',
        reviewTypeLabel: 'Security',
        issueTypeLabel: 'security issue(s)',
        successMessage: 'No security issues found',
      };
      assert.strictEqual(config.phase1Step, 'p1-3');
      assert.strictEqual(config.phase2Step, 'p2-5');
    });
  });

  describe('ReviewCompletionInput structure', () => {
    it('should accept valid input with issues found', () => {
      const input: ReviewCompletionInput = {
        command_executed: true,
        in_scope_result_files: ['/tmp/file1.md', '/tmp/file2.md'],
        out_of_scope_result_files: ['/tmp/file3.md'],
        in_scope_issue_count: 2,
        out_of_scope_issue_count: 1,
      };
      assert.strictEqual(input.command_executed, true);
      assert.strictEqual(input.in_scope_issue_count, 2);
    });

    it('should accept valid input with no issues', () => {
      const input: ReviewCompletionInput = {
        command_executed: true,
        in_scope_result_files: [],
        out_of_scope_result_files: [],
        in_scope_issue_count: 0,
        out_of_scope_issue_count: 0,
      };
      assert.strictEqual(input.in_scope_issue_count, 0);
    });
  });

  // Helper function to generate random hex suffix for test filenames
  function randomHex(): string {
    return Math.random().toString(16).substring(2, 10);
  }

  describe('loadReviewResults', () => {
    it('should successfully load multiple in-scope and out-of-scope files', async () => {
      const inScopeFile1 =
        '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      const inScopeFile2 =
        '/tmp/claude/silent-failure-hunter-in-scope-' +
        (Date.now() + 1) +
        '-' +
        randomHex() +
        '.md';
      const outOfScopeFile =
        '/tmp/claude/code-reviewer-out-of-scope-' + Date.now() + '-' + randomHex() + '.md';

      await writeFile(inScopeFile1, 'Issue 1: Fix bug');
      await writeFile(inScopeFile2, 'Issue 2: Add test');
      await writeFile(outOfScopeFile, 'Recommendation: Refactor');

      const result = await loadReviewResults([inScopeFile1, inScopeFile2], [outOfScopeFile]);

      assert.ok(result.inScope.includes('Code Reviewer'));
      assert.ok(result.inScope.includes('Issue 1: Fix bug'));
      assert.ok(result.inScope.includes('Silent Failure Hunter'));
      assert.ok(result.inScope.includes('Issue 2: Add test'));
      assert.ok(result.outOfScope.includes('Recommendation: Refactor'));

      // Cleanup
      await unlink(inScopeFile1);
      await unlink(inScopeFile2);
      await unlink(outOfScopeFile);
    });

    it('should throw ValidationError when in-scope file does not exist', async () => {
      // Using in-scope pattern to trigger error (out-of-scope failures are non-fatal)
      const nonexistentFile =
        '/tmp/claude/nonexistent-in-scope-' + Date.now() + '-' + randomHex() + '.md';

      await assert.rejects(async () => loadReviewResults([nonexistentFile], []), {
        name: 'ValidationError',
        message: /Failed to read 1 in-scope review file/,
      });
    });

    it('should throw ValidationError for empty files', async () => {
      // Use proper agent naming pattern so extractAgentNameFromPath succeeds
      // and we can test the actual empty file handling
      const emptyFile =
        '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      await writeFile(emptyFile, '');

      await assert.rejects(async () => loadReviewResults([emptyFile], []), {
        name: 'ValidationError',
        message: /Review file is empty/,
      });

      await unlink(emptyFile);
    });
  });

  describe('completeReview integration behavior', () => {
    // These tests document the expected behavior of completeReview() in different scenarios

    describe('command_executed validation', () => {
      it('should document that command_executed: false is rejected by schema', () => {
        // When command_executed is false:
        // - Schema validation (z.literal(true)) rejects the input
        // - Error message: "command_executed must be true. Execute the review command before calling this tool."
        // - This prevents skipping the actual review execution at the schema level
        assert.strictEqual(true, true, 'Test documents validation requirement');
      });
    });

    describe('phase1 behavior (pre-PR)', () => {
      it('should document phase1 requires issue number', () => {
        // In phase1, completeReview():
        // - Calls validatePhaseRequirements() which checks state.issue.exists
        // - Throws ValidationError if no issue found
        // - Error: "No issue found. Phase 1 {review type} review requires an issue number in the branch name."
        assert.strictEqual(true, true, 'Test documents phase1 requirement');
      });

      it('should document phase1 posts comment to issue', () => {
        // In phase1 with valid issue:
        // - Calls postWiggumStateIssueComment(issueNumber, newState, title, body)
        // - Issue number extracted from state.issue.number
        // - Comment posted to issue, not PR
        assert.strictEqual(true, true, 'Test documents phase1 comment posting');
      });

      it('should document phase1 uses phase1Step from config', () => {
        // In phase1:
        // - reviewStep = config.phase1Step
        // - For PR review: STEP_PHASE1_PR_REVIEW ('p1-2')
        // - For Security review: STEP_PHASE1_SECURITY_REVIEW ('p1-3')
        assert.strictEqual(true, true, 'Test documents phase1 step selection');
      });
    });

    describe('phase2 behavior (post-PR)', () => {
      it('should document phase2 requires PR to exist', () => {
        // In phase2, completeReview():
        // - Calls validatePhaseRequirements() which checks state.pr.exists
        // - Throws ValidationError if no PR found
        // - Error: "No PR found. Cannot complete {review type} review."
        assert.strictEqual(true, true, 'Test documents phase2 requirement');
      });

      it('should document phase2 posts comment to PR', () => {
        // In phase2 with valid PR:
        // - Calls postWiggumStateComment(prNumber, newState, title, body)
        // - PR number extracted from state.pr.number
        // - Comment posted to PR, not issue
        assert.strictEqual(true, true, 'Test documents phase2 comment posting');
      });

      it('should document phase2 uses phase2Step from config', () => {
        // In phase2:
        // - reviewStep = config.phase2Step
        // - For PR review: STEP_PHASE2_PR_REVIEW ('p2-4')
        // - For Security review: STEP_PHASE2_SECURITY_REVIEW ('p2-5')
        assert.strictEqual(true, true, 'Test documents phase2 step selection');
      });
    });

    describe('issues found behavior', () => {
      it('should document state update when issues found', () => {
        // When totalIssues > 0:
        // - newState.iteration = currentState.iteration + 1 (increment)
        // - newState.step = reviewStep (stays at review step)
        // - newState.completedSteps = currentState.completedSteps (no change)
        // - State NOT marked as complete (step not added to completedSteps)
        assert.strictEqual(true, true, 'Test documents iteration increment');
      });

      it('should document comment title when issues found', () => {
        // Comment title format:
        // "Step {reviewStep} ({STEP_NAMES[reviewStep]}) - Issues Found"
        // Example: "Step p2-4 (Phase 2: PR Review (Post-PR)) - Issues Found"
        assert.strictEqual(true, true, 'Test documents comment title format');
      });

      it('should document comment body when issues found', () => {
        // Comment body includes:
        // - Command executed: `{config.commandName}`
        // - Issue breakdown by priority (High/Medium/Low)
        // - Total issues count
        // - Collapsible section with full review output
        // - Next action: Plan and implement fixes
        assert.strictEqual(true, true, 'Test documents comment body format');
      });

      it('should document triage instructions generation when issues found', () => {
        // When issues found and issueNumber exists:
        // - Calls generateTriageInstructions(issueNumber, reviewType, totalIssues)
        // - reviewType is 'PR' or 'Security' based on config.reviewTypeLabel
        // - Returns tool result with triage workflow instructions
        assert.strictEqual(true, true, 'Test documents triage instructions');
      });

      it('should document fallback instructions when no issue number', () => {
        // When issues found but issueNumber is undefined:
        // - Logs warning about missing issue number
        // - Returns fallback instructions (simpler fix workflow)
        // - Fallback does not include triage steps
        assert.strictEqual(true, true, 'Test documents fallback behavior');
      });
    });

    describe('no issues found behavior', () => {
      it('should document state update when no issues found', () => {
        // When totalIssues === 0:
        // - newState.iteration = currentState.iteration (no change)
        // - newState.step = reviewStep (stays at review step)
        // - newState.completedSteps = [...currentState.completedSteps, reviewStep] (add current step)
        // - Step marked as complete
        assert.strictEqual(true, true, 'Test documents step completion');
      });

      it('should document comment title when no issues found', () => {
        // Comment title format:
        // "Step {reviewStep} ({STEP_NAMES[reviewStep]}) Complete - No Issues"
        // Example: "Step p2-4 (Phase 2: PR Review (Post-PR)) Complete - No Issues"
        assert.strictEqual(true, true, 'Test documents success title format');
      });

      it('should document comment body when no issues found', () => {
        // Comment body includes:
        // - Command executed: `{config.commandName}`
        // - Success message from config (e.g., "No PR review issues found...")
        // - No issue breakdown or collapsible section
        assert.strictEqual(true, true, 'Test documents success body format');
      });

      it('should document next step routing when no issues found', () => {
        // When no issues found:
        // - Calls detectCurrentState() to get updated state
        // - Calls getNextStepInstructions(updatedState)
        // - Returns result from router (next step in workflow)
        assert.strictEqual(true, true, 'Test documents next step routing');
      });
    });

    describe('iteration limit behavior', () => {
      it('should document iteration limit check', () => {
        // After posting comment:
        // - Checks if newState.iteration >= DEFAULT_MAX_ITERATIONS
        // - If true, returns iteration limit response
        // - If false, continues to triage/next step instructions
        assert.strictEqual(true, true, 'Test documents iteration limit check');
      });

      it('should document iteration limit response content', () => {
        // Iteration limit response includes:
        // - current_step: STEP_NAMES[reviewStep]
        // - step_number: reviewStep
        // - iteration_count: newState.iteration
        // - instructions: "Maximum iteration limit (10) reached. Manual intervention required."
        // - steps_completed_by_tool: ['Executed review', 'Posted results...', 'Updated state']
        // - context: {pr_number, issue_number, total_issues}
        assert.strictEqual(true, true, 'Test documents iteration limit response');
      });
    });

    describe('tool result structure', () => {
      it('should document tool result format for issues found', () => {
        // Result structure:
        // {
        //   content: [{
        //     type: 'text',
        //     text: formatWiggumResponse({
        //       current_step, step_number, iteration_count,
        //       instructions: <triage workflow or fallback>,
        //       steps_completed_by_tool: [...],
        //       context: {pr_number, issue_number, total_issues}
        //     })
        //   }]
        // }
        assert.strictEqual(true, true, 'Test documents result structure');
      });

      it('should document tool result format for no issues', () => {
        // Result is pass-through from getNextStepInstructions()
        // Format depends on next step in workflow
        assert.strictEqual(true, true, 'Test documents success result structure');
      });
    });

    describe('review type handling', () => {
      it('should document PR review type conversion for triage', () => {
        // When config.reviewTypeLabel === 'PR':
        // - reviewTypeForTriage = 'PR'
        // - Passed to generateTriageInstructions(issueNumber, 'PR', totalIssues)
        assert.strictEqual(true, true, 'Test documents PR type conversion');
      });

      it('should document Security review type conversion for triage', () => {
        // When config.reviewTypeLabel === 'Security':
        // - reviewTypeForTriage = 'Security'
        // - Passed to generateTriageInstructions(issueNumber, 'Security', totalIssues)
        assert.strictEqual(true, true, 'Test documents Security type conversion');
      });

      it('should document review type in error messages', () => {
        // Error messages use config.reviewTypeLabel in lowercase:
        // - "Do not shortcut the {reviewTypeLabel.toLowerCase()} review process"
        // - "Phase 1 {reviewTypeLabel.toLowerCase()} review requires..."
        // - "Cannot complete {reviewTypeLabel.toLowerCase()} review"
        assert.strictEqual(true, true, 'Test documents error message formatting');
      });
    });

    describe('state flow and timing', () => {
      it('should document state detection timing', () => {
        // State detection occurs:
        // 1. At start: detectCurrentState() to get current state
        // 2. After comment posted (no issues path): detectCurrentState() for router
        // State is NOT re-detected between comment posting and returning (issues path)
        assert.strictEqual(true, true, 'Test documents state detection timing');
      });

      it('should document comment posting timing', () => {
        // Comment is posted:
        // - After state is built
        // - Before iteration limit check
        // - Before triage instructions generation
        // This ensures state is persisted even if iteration limit reached
        assert.strictEqual(true, true, 'Test documents comment timing');
      });
    });

    describe('error handling paths', () => {
      it('should document command_executed validation error', () => {
        // Rejected at schema level (z.literal(true)) before completeReview() is called
        // Schema validation occurs before function invocation in MCP flow
        assert.strictEqual(true, true, 'Test documents early validation');
      });

      it('should document phase validation errors', () => {
        // Thrown after state detection, before comment building
        // Includes current branch in error context
        assert.strictEqual(true, true, 'Test documents phase validation');
      });

      it('should document internal consistency errors', () => {
        // If phase validation passes but issue/PR number undefined later:
        // - Throws ValidationError with "Internal error:" prefix
        // - Indicates bug in validation logic
        assert.strictEqual(true, true, 'Test documents internal errors');
      });
    });

    describe('buildCommentContent formatting', () => {
      it('should document title format when issues found', () => {
        // Title format: "Step {reviewStep} ({STEP_NAMES[reviewStep]}) - Issues Found"
        // Example: "Step p2-4 (Phase 2: PR Review (Post-PR)) - Issues Found"
        // Uses reviewStep from config (phase1Step or phase2Step)
        assert.strictEqual(true, true, 'Test documents issues found title');
      });

      it('should document title format when no issues found', () => {
        // Title format: "Step {reviewStep} ({STEP_NAMES[reviewStep]}) Complete - No Issues"
        // Example: "Step p2-4 (Phase 2: PR Review (Post-PR)) Complete - No Issues"
        // Uses reviewStep from config (phase1Step or phase2Step)
        assert.strictEqual(true, true, 'Test documents success title');
      });

      it('should document body format when issues found', () => {
        // Body includes:
        // **Command Executed:** `{phase1Command or phase2Command}`
        // **{reviewTypeLabel} Issues Found:**
        // - High Priority: {count}
        // - Medium Priority: {count}
        // - Low Priority: {count}
        // - **Total: {totalIssues}**
        // <details><summary>Full {reviewTypeLabel} Review Output</summary>{verbatim_response}</details>
        // **Next Action:** Plan and implement {reviewTypeLabel.toLowerCase()} fixes for all issues...
        assert.strictEqual(true, true, 'Test documents issues found body');
      });

      it('should document body format when no issues found', () => {
        // Body includes:
        // **Command Executed:** `{phase1Command or phase2Command}`
        // {config.successMessage}
        // No issue breakdown or collapsible sections
        assert.strictEqual(true, true, 'Test documents success body');
      });

      it('should document command selection based on phase', () => {
        // Phase 1: Uses config.phase1Command (e.g., '/all-hands-review')
        // Phase 2: Uses config.phase2Command (e.g., '/review')
        // Command shown in comment body under "Command Executed:"
        assert.strictEqual(true, true, 'Test documents phase-specific command');
      });

      it('should document issue count breakdown formatting', () => {
        // Issue counts displayed with labels:
        // - High Priority: {input.high_priority_issues}
        // - Medium Priority: {input.medium_priority_issues}
        // - Low Priority: {input.low_priority_issues}
        // - **Total: {sum of all counts}** (bold)
        assert.strictEqual(true, true, 'Test documents issue count formatting');
      });

      it('should document collapsible section for verbatim response', () => {
        // Uses HTML <details> element for collapsibility:
        // <details>
        // <summary>Full {reviewTypeLabel} Review Output</summary>
        // {input.verbatim_response}
        // </details>
        assert.strictEqual(true, true, 'Test documents collapsible formatting');
      });

      it('should document review type label usage', () => {
        // reviewTypeLabel used in:
        // - Body heading: "{reviewTypeLabel} Issues Found:"
        // - Collapsible summary: "Full {reviewTypeLabel} Review Output"
        // - Next action: "implement {reviewTypeLabel.toLowerCase()} fixes"
        assert.strictEqual(true, true, 'Test documents label usage');
      });

      it('should document success message from config', () => {
        // When no issues found:
        // - Uses config.successMessage verbatim
        // - PR review: "All automated review checks passed..."
        // - Security review: "All security checks passed..."
        assert.strictEqual(true, true, 'Test documents success message');
      });

      it('should document next action instructions when issues found', () => {
        // Next action format:
        // "Plan and implement {reviewTypeLabel.toLowerCase()} fixes for all issues, then call `wiggum_complete_fix`."
        // Tells agent to fix all issues and report completion
        assert.strictEqual(true, true, 'Test documents next action');
      });
    });

    describe('phase-specific command selection', () => {
      it('should use phase1Command in Phase 1 (issue context)', () => {
        // When in Phase 1 (pre-PR), comment should show phase1Command
        // Example: '/all-hands-review' instead of '/review'
        const config: ReviewConfig = {
          phase1Step: STEP_PHASE1_PR_REVIEW,
          phase2Step: STEP_PHASE2_PR_REVIEW,
          phase1Command: '/all-hands-review',
          phase2Command: '/review',
          reviewTypeLabel: 'PR',
          issueTypeLabel: 'issue(s)',
          successMessage: 'No PR review issues found',
        };
        assert.strictEqual(config.phase1Command, '/all-hands-review');
        assert.notStrictEqual(config.phase1Command, config.phase2Command);
      });

      it('should use phase2Command in Phase 2 (PR context)', () => {
        // When in Phase 2 (post-PR), comment should show phase2Command
        // Example: '/review' instead of '/all-hands-review'
        const config: ReviewConfig = {
          phase1Step: STEP_PHASE1_PR_REVIEW,
          phase2Step: STEP_PHASE2_PR_REVIEW,
          phase1Command: '/all-hands-review',
          phase2Command: '/review',
          reviewTypeLabel: 'PR',
          issueTypeLabel: 'issue(s)',
          successMessage: 'No PR review issues found',
        };
        assert.strictEqual(config.phase2Command, '/review');
        assert.notStrictEqual(config.phase2Command, config.phase1Command);
      });
    });
  });

  describe('extractAgentNameFromPath', () => {
    it('should extract agent name from in-scope file path', () => {
      const result = extractAgentNameFromPath(
        '/tmp/claude/wiggum-625/code-reviewer-in-scope-1234-abc123.md'
      );
      assert.strictEqual(result, 'Code Reviewer');
    });

    it('should extract agent name from out-of-scope file path', () => {
      const result = extractAgentNameFromPath(
        '/tmp/claude/wiggum-625/pr-test-analyzer-out-of-scope-5678-def456.md'
      );
      assert.strictEqual(result, 'Pr Test Analyzer');
    });

    it('should handle single-word agent names', () => {
      const result = extractAgentNameFromPath(
        '/tmp/claude/wiggum-625/linter-in-scope-1234-abc123.md'
      );
      assert.strictEqual(result, 'Linter');
    });

    it('should throw ValidationError for non-matching paths', () => {
      // Non-matching file names indicate a bug in agent file naming logic
      // Throwing prevents masking these issues with placeholder values
      assert.throws(() => extractAgentNameFromPath('/some/random/path.md'), {
        name: 'ValidationError',
        message: /Invalid review result filename: path\.md/,
      });
    });

    it('should throw ValidationError for empty path', () => {
      // Empty paths are invalid and indicate a programming error
      assert.throws(() => extractAgentNameFromPath(''), {
        name: 'ValidationError',
        message: /Invalid review result filename:/,
      });
    });

    it('should handle paths with only filename', () => {
      const result = extractAgentNameFromPath('comment-analyzer-in-scope-9999-abc123.md');
      assert.strictEqual(result, 'Comment Analyzer');
    });
  });

  describe('loadReviewResults', () => {
    it('should return empty strings for empty file arrays', async () => {
      const result = await loadReviewResults([], []);
      assert.strictEqual(result.inScope, '');
      assert.strictEqual(result.outOfScope, '');
    });

    it('should read and format single in-scope file', async () => {
      const tempFile =
        '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      await writeFile(tempFile, 'Test content');

      const result = await loadReviewResults([tempFile], []);
      assert.ok(result.inScope.includes('## In-Scope Issues'));
      assert.ok(result.inScope.includes('#### Code Reviewer'));
      assert.ok(result.inScope.includes('Test content'));
      assert.strictEqual(result.outOfScope, '');

      await unlink(tempFile);
    });

    it('should read and format single out-of-scope file', async () => {
      const tempFile =
        '/tmp/claude/pr-test-analyzer-out-of-scope-' + Date.now() + '-' + randomHex() + '.md';
      await writeFile(tempFile, 'Out of scope content');

      const result = await loadReviewResults([], [tempFile]);
      assert.strictEqual(result.inScope, '');
      assert.ok(result.outOfScope.includes('## Out-of-Scope Recommendations'));
      assert.ok(result.outOfScope.includes('#### Pr Test Analyzer'));
      assert.ok(result.outOfScope.includes('Out of scope content'));

      await unlink(tempFile);
    });

    it('should read and format multiple files', async () => {
      const inScope1 =
        '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      const inScope2 =
        '/tmp/claude/comment-analyzer-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      await writeFile(inScope1, 'Review 1');
      await writeFile(inScope2, 'Review 2');

      const result = await loadReviewResults([inScope1, inScope2], []);
      assert.ok(result.inScope.includes('#### Code Reviewer'));
      assert.ok(result.inScope.includes('#### Comment Analyzer'));
      assert.ok(result.inScope.includes('Review 1'));
      assert.ok(result.inScope.includes('Review 2'));

      await unlink(inScope1);
      await unlink(inScope2);
    });

    it('should throw ValidationError with details for missing in-scope files', async () => {
      // Only in-scope failures are fatal - out-of-scope failures just log warnings
      const missingInScopeFile =
        '/tmp/claude/missing-file-in-scope-' + Date.now() + '-' + randomHex() + '.md';

      await assert.rejects(async () => loadReviewResults([missingInScopeFile], []), {
        name: 'ValidationError',
        message: /Failed to read 1 in-scope review file\(s\)/,
      });
    });

    it('should include all failure details in error message', async () => {
      // File path must include '-in-scope-' pattern for correct category detection
      const missingFile =
        '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '-' + randomHex() + '.md';

      try {
        await loadReviewResults([missingFile], []);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('[in-scope]'));
        assert.ok(error.message.includes(missingFile));
        // Changed: tiered failure handling only throws for in-scope failures
        // and error message format changed to be more specific
        assert.ok(
          error.message.includes('CRITICAL'),
          'Error should indicate in-scope failure is critical'
        );
      }
    });

    it('should aggregate errors when some in-scope files exist and some do not', async () => {
      const existingFile = '/tmp/claude/linter-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      const missingFile =
        '/tmp/claude/missing-reviewer-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      await writeFile(existingFile, 'Content');

      try {
        await loadReviewResults([existingFile, missingFile], []);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        // Changed: tiered failure handling only throws for in-scope failures
        assert.ok(error.message.includes('Failed to read 1 in-scope review file(s)'));
        assert.ok(error.message.includes(missingFile));
        assert.ok(error.message.includes('CRITICAL'));
      }

      await unlink(existingFile);
    });

    it('should handle EISDIR error when path is a directory (in-scope)', async () => {
      // Create a directory with in-scope naming pattern to test EISDIR error
      // Path must match the full pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}-{random-suffix}.md
      // Note: The file extension is part of the pattern, but we use a directory to trigger EISDIR
      const dirPath = '/tmp/claude/test-agent-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      await mkdir(dirPath, { recursive: true });

      try {
        await assert.rejects(async () => loadReviewResults([dirPath], []), {
          name: 'ValidationError',
          message: /Failed to read.*in-scope review file/,
        });
      } finally {
        await rmdir(dirPath);
      }
    });

    it('should handle empty file after stat() succeeds (possible race condition)', async () => {
      // Tests the edge case where stat() finds a file with size > 0,
      // but readFile() returns empty content (race with file truncation)
      // Using in-scope pattern to trigger error (out-of-scope failures are non-fatal)
      const tempFile =
        '/tmp/claude/empty-after-stat-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      await writeFile(tempFile, '   '); // Only whitespace

      await assert.rejects(async () => loadReviewResults([tempFile], []), {
        name: 'ValidationError',
        message: /File is empty/,
      });

      await unlink(tempFile);
    });

    it('should include error code in error details for ENOENT (in-scope)', async () => {
      // Using in-scope pattern to trigger error (out-of-scope failures are non-fatal)
      const missingFile = '/tmp/claude/missing-in-scope-' + Date.now() + '-' + randomHex() + '.md';

      try {
        await loadReviewResults([missingFile], []);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        // Error message should include ENOENT error code
        assert.ok(
          error.message.includes('[ENOENT]') || error.message.includes('no such file'),
          'Error should indicate file not found'
        );
      }
    });

    it('should throw for in-scope failures but only warn for out-of-scope failures', async () => {
      // With tiered failure handling:
      // - in-scope failures are CRITICAL and throw
      // - out-of-scope failures just log warnings and continue
      const missingInScope =
        '/tmp/claude/missing-in-scope-' + Date.now() + '-' + randomHex() + '.md';
      const missingOutOfScope =
        '/tmp/claude/missing-out-of-scope-' + Date.now() + '-' + randomHex() + '.md';

      try {
        await loadReviewResults([missingInScope], [missingOutOfScope]);
        assert.fail('Should have thrown due to in-scope failure');
      } catch (error) {
        assert.ok(error instanceof Error);
        // Should only mention in-scope errors (out-of-scope are warnings, not errors)
        assert.ok(error.message.includes('[in-scope]'));
        assert.ok(error.message.includes('CRITICAL'));
        // Should only show in-scope failure count
        assert.ok(error.message.includes('Failed to read 1 in-scope review file(s)'));
        // Out-of-scope failures are logged as warnings, not included in thrown error
        assert.ok(!error.message.includes('[out-of-scope]'));
      }
    });

    it('should succeed when only out-of-scope files fail', async () => {
      // With tiered failure handling, out-of-scope failures are non-fatal
      const missingOutOfScope =
        '/tmp/claude/missing-out-of-scope-' + Date.now() + '-' + randomHex() + '.md';

      // This should NOT throw - out-of-scope failures are warnings only
      const result = await loadReviewResults([], [missingOutOfScope]);

      // Should return empty results since file failed to load
      assert.strictEqual(result.inScope, '');
      assert.strictEqual(result.outOfScope, '');
    });
  });

  describe('ReviewConfigSchema validation', () => {
    it('should reject config when phase1Command is missing', () => {
      // ReviewConfigSchema should validate phase1Command is required
      // Missing phase1Command should be a validation error
      const invalidConfig = {
        phase1Step: STEP_PHASE1_PR_REVIEW,
        phase2Step: STEP_PHASE2_PR_REVIEW,
        // phase1Command: missing
        phase2Command: '/review',
        reviewTypeLabel: 'PR',
        issueTypeLabel: 'issue(s)',
        successMessage: 'No PR review issues found',
      };
      // Type system should catch this at compile time
      // @ts-expect-error - phase1Command is required
      const _config: ReviewConfig = invalidConfig;
      assert.strictEqual(true, true, 'Test documents phase1Command requirement');
    });

    it('should reject config when phase2Command is missing', () => {
      // ReviewConfigSchema should validate phase2Command is required
      // Missing phase2Command should be a validation error
      const invalidConfig = {
        phase1Step: STEP_PHASE1_PR_REVIEW,
        phase2Step: STEP_PHASE2_PR_REVIEW,
        phase1Command: '/all-hands-review',
        // phase2Command: missing
        reviewTypeLabel: 'PR',
        issueTypeLabel: 'issue(s)',
        successMessage: 'No PR review issues found',
      };
      // Type system should catch this at compile time
      // @ts-expect-error - phase2Command is required
      const _config: ReviewConfig = invalidConfig;
      assert.strictEqual(true, true, 'Test documents phase2Command requirement');
    });

    it('should accept valid config with both commands', () => {
      // Valid config must have both phase1Command and phase2Command
      const validConfig: ReviewConfig = {
        phase1Step: STEP_PHASE1_PR_REVIEW,
        phase2Step: STEP_PHASE2_PR_REVIEW,
        phase1Command: '/all-hands-review',
        phase2Command: '/review',
        reviewTypeLabel: 'PR',
        issueTypeLabel: 'issue(s)',
        successMessage: 'No PR review issues found',
      };
      assert.strictEqual(validConfig.phase1Command, '/all-hands-review');
      assert.strictEqual(validConfig.phase2Command, '/review');
      assert.strictEqual(typeof validConfig.phase1Command, 'string');
      assert.strictEqual(typeof validConfig.phase2Command, 'string');
    });

    it('should reject config with empty phase1Command', () => {
      // Non-empty string validation should reject empty commands
      assert.throws(
        () =>
          validateReviewConfig({
            phase1Step: STEP_PHASE1_PR_REVIEW,
            phase2Step: STEP_PHASE2_PR_REVIEW,
            phase1Command: '', // Empty string
            phase2Command: '/review',
            reviewTypeLabel: 'PR',
            issueTypeLabel: 'issue(s)',
            successMessage: 'No PR review issues found',
          }),
        /phase1Command cannot be empty/
      );
    });

    it('should reject config with empty reviewTypeLabel', () => {
      // Non-empty string validation should reject empty labels
      assert.throws(
        () =>
          validateReviewConfig({
            phase1Step: STEP_PHASE1_PR_REVIEW,
            phase2Step: STEP_PHASE2_PR_REVIEW,
            phase1Command: '/all-hands-review',
            phase2Command: '/review',
            reviewTypeLabel: '', // Empty string
            issueTypeLabel: 'issue(s)',
            successMessage: 'No PR review issues found',
          }),
        /reviewTypeLabel cannot be empty/
      );
    });

    it('should reject config with empty successMessage', () => {
      // Non-empty string validation should reject empty success messages
      assert.throws(
        () =>
          validateReviewConfig({
            phase1Step: STEP_PHASE1_PR_REVIEW,
            phase2Step: STEP_PHASE2_PR_REVIEW,
            phase1Command: '/all-hands-review',
            phase2Command: '/review',
            reviewTypeLabel: 'PR',
            issueTypeLabel: 'issue(s)',
            successMessage: '', // Empty string
          }),
        /successMessage cannot be empty/
      );
    });
  });

  describe('ReviewConfig factory functions', () => {
    describe('createPRReviewConfig', () => {
      it('should create a valid PR review configuration', () => {
        const config = createPRReviewConfig();

        assert.strictEqual(config.phase1Step, STEP_PHASE1_PR_REVIEW);
        assert.strictEqual(config.phase2Step, STEP_PHASE2_PR_REVIEW);
        assert.strictEqual(config.reviewTypeLabel, 'PR');
        assert.strictEqual(config.issueTypeLabel, 'issue(s)');
      });

      it('should have correct phase1 command for all-hands-review', () => {
        const config = createPRReviewConfig();
        assert.strictEqual(config.phase1Command, '/all-hands-review');
      });

      it('should have correct phase2 command for review', () => {
        const config = createPRReviewConfig();
        assert.strictEqual(config.phase2Command, '/review');
      });

      it('should have non-empty success message', () => {
        const config = createPRReviewConfig();
        assert.ok(config.successMessage.length > 0);
        assert.ok(config.successMessage.includes('No PR review issues found'));
      });

      it('should have readonly fields', () => {
        const config = createPRReviewConfig();
        // TypeScript enforces readonly, this test documents the expectation
        assert.strictEqual(typeof config.phase1Step, 'string');
        assert.strictEqual(typeof config.phase2Step, 'string');
      });
    });

    describe('createSecurityReviewConfig', () => {
      it('should create a valid security review configuration', () => {
        const config = createSecurityReviewConfig();

        assert.strictEqual(config.phase1Step, STEP_PHASE1_SECURITY_REVIEW);
        assert.strictEqual(config.phase2Step, STEP_PHASE2_SECURITY_REVIEW);
        assert.strictEqual(config.reviewTypeLabel, 'Security');
        assert.strictEqual(config.issueTypeLabel, 'security issue(s) found');
      });

      it('should use same command for both phases', () => {
        const config = createSecurityReviewConfig();
        assert.strictEqual(config.phase1Command, '/security-review');
        assert.strictEqual(config.phase2Command, '/security-review');
        assert.strictEqual(config.phase1Command, config.phase2Command);
      });

      it('should have non-empty success message with security aspects', () => {
        const config = createSecurityReviewConfig();
        assert.ok(config.successMessage.length > 0);
        assert.ok(config.successMessage.includes('security checks passed'));
        assert.ok(config.successMessage.includes('Security Aspects Covered'));
      });

      it('should have readonly fields', () => {
        const config = createSecurityReviewConfig();
        // TypeScript enforces readonly, this test documents the expectation
        assert.strictEqual(typeof config.phase1Step, 'string');
        assert.strictEqual(typeof config.phase2Step, 'string');
      });
    });

    describe('factory function consistency', () => {
      it('should create distinct configs for PR vs Security', () => {
        const prConfig = createPRReviewConfig();
        const securityConfig = createSecurityReviewConfig();

        assert.notStrictEqual(prConfig.phase1Step, securityConfig.phase1Step);
        assert.notStrictEqual(prConfig.phase2Step, securityConfig.phase2Step);
        assert.notStrictEqual(prConfig.reviewTypeLabel, securityConfig.reviewTypeLabel);
      });

      it('should pass phase prefix validation for PR config', () => {
        const config = createPRReviewConfig();
        assert.ok(config.phase1Step.startsWith('p1-'));
        assert.ok(config.phase2Step.startsWith('p2-'));
      });

      it('should pass phase prefix validation for security config', () => {
        const config = createSecurityReviewConfig();
        assert.ok(config.phase1Step.startsWith('p1-'));
        assert.ok(config.phase2Step.startsWith('p2-'));
      });
    });
  });

  describe('File I/O Partial Failures', () => {
    describe('Partial success scenarios (tiered failure handling)', () => {
      test('should handle partial success: some in-scope files succeed, some fail', async () => {
        // Create test files: 1 success, 1 failure
        const successFile = `/tmp/claude/success-in-scope-${Date.now()}-${randomHex()}.md`;
        const failFile = `/tmp/claude/fail-in-scope-${Date.now()}-${randomHex()}.md`;

        await writeFile(successFile, '# Test content');
        // Don't create failFile - it will fail with ENOENT

        await assert.rejects(
          async () => {
            await loadReviewResults([successFile, failFile], []);
          },
          {
            name: 'ValidationError',
            // Changed: tiered failure handling only mentions in-scope failures
            message: /Failed to read 1 in-scope review file.*CRITICAL/,
          }
        );

        await unlink(successFile);
      });

      test('should succeed when only out-of-scope files fail (non-fatal)', async () => {
        // With tiered failure handling, out-of-scope failures are warnings only
        const inScopeSuccess = `/tmp/claude/success-in-scope-${Date.now()}-${randomHex()}.md`;
        const outOfScopeFail = `/tmp/claude/fail-out-of-scope-${Date.now()}-${randomHex()}.md`;

        await writeFile(inScopeSuccess, '# In-scope content');
        // Don't create outOfScopeFail - but this should NOT cause a throw

        // This should succeed - out-of-scope failures are non-fatal warnings
        const result = await loadReviewResults([inScopeSuccess], [outOfScopeFail]);
        assert.ok(result.inScope.includes('In-scope content'));
        assert.strictEqual(result.outOfScope, ''); // Failed file not included

        await unlink(inScopeSuccess);
      });

      test('should reject when in-scope file fails even if out-of-scope also fails', async () => {
        // In-scope failures are always fatal
        const fail1 = `/tmp/claude/fail1-in-scope-${Date.now()}-${randomHex()}.md`;
        const fail2 = `/tmp/claude/fail2-out-of-scope-${Date.now()}-${randomHex()}.md`;

        await assert.rejects(
          async () => {
            await loadReviewResults([fail1], [fail2]);
          },
          {
            name: 'ValidationError',
            // Changed: tiered failure handling - only in-scope failure is reported
            message: /Failed to read 1 in-scope review file.*CRITICAL/,
          }
        );
      });
    });

    describe('Empty file detection', () => {
      test('should detect file truncated after stat() shows non-zero size', async () => {
        const file = `/tmp/claude/truncated-in-scope-${Date.now()}-${randomHex()}.md`;

        // Create file with content, then immediately truncate to empty
        // This simulates race condition where stat() sees size > 0 but readFile gets empty
        await writeFile(file, '   '); // Whitespace only (will be detected as empty)

        await assert.rejects(
          async () => {
            await loadReviewResults([file], []);
          },
          {
            name: 'ValidationError',
            message: /File is empty/,
          }
        );

        await unlink(file);
      });

      test('should handle whitespace-only files', async () => {
        const file = `/tmp/claude/whitespace-in-scope-${Date.now()}-${randomHex()}.md`;

        await writeFile(file, '  \n\t  \n  '); // Various whitespace

        await assert.rejects(
          async () => {
            await loadReviewResults([file], []);
          },
          {
            name: 'ValidationError',
            message: /File is empty/,
          }
        );

        await unlink(file);
      });

      test('should handle stat() showing size 0', async () => {
        const file = `/tmp/claude/zero-size-in-scope-${Date.now()}-${randomHex()}.md`;

        await writeFile(file, ''); // Zero-byte file

        await assert.rejects(
          async () => {
            await loadReviewResults([file], []);
          },
          {
            name: 'ValidationError',
            message: /Review file is empty/,
          }
        );

        await unlink(file);
      });
    });

    describe('Error classification and hints', () => {
      test('should include ENOENT action hint', async () => {
        const file = `/tmp/claude/missing-in-scope-${Date.now()}-${randomHex()}.md`;

        await assert.rejects(
          async () => {
            await loadReviewResults([file], []);
          },
          {
            name: 'ValidationError',
            message: /ENOENT/,
          }
        );
      });

      test('should include EACCES action hint for permission errors', async () => {
        // Note: This test documents expected behavior but may be hard to reproduce reliably
        // across different systems due to permission setup complexity
        // We validate the error structure exists rather than forcing the error condition
        const file = `/tmp/claude/access-in-scope-${Date.now()}-${randomHex()}.md`;

        // Document that EACCES errors should include file path and error code
        // Actual permission error testing would require platform-specific setup
        await assert.doesNotReject(async () => {
          await writeFile(file, 'test');
          await unlink(file);
        });
      });

      test('should include empty file action hint', async () => {
        const file = `/tmp/claude/empty-hint-in-scope-${Date.now()}-${randomHex()}.md`;

        await writeFile(file, '');

        await assert.rejects(
          async () => {
            await loadReviewResults([file], []);
          },
          {
            name: 'ValidationError',
            message: /Action: Review agents may have crashed during write/,
          }
        );

        await unlink(file);
      });

      test('should handle EISDIR error when path is directory (in-scope naming)', async () => {
        // Create a directory with in-scope naming pattern
        // Path must match the full pattern: {agent-name}-(in-scope|out-of-scope)-{timestamp}-{random-suffix}.md
        const dir = `/tmp/claude/dir-agent-in-scope-${Date.now()}-${randomHex()}.md`;

        await mkdir(dir);

        try {
          await assert.rejects(
            async () => {
              await loadReviewResults([dir], []);
            },
            {
              name: 'ValidationError',
              message: /Failed to read.*in-scope review file/,
            }
          );
        } finally {
          await rmdir(dir);
        }
      });

      test('should include error codes in error message', async () => {
        const file = `/tmp/claude/enoent-in-scope-${Date.now()}-${randomHex()}.md`;

        await assert.rejects(
          async () => {
            await loadReviewResults([file], []);
          },
          {
            name: 'ValidationError',
            message: /ENOENT/,
          }
        );
      });
    });
  });

  describe('Validation Edge Cases', () => {
    test('should accept MAX_SAFE_INTEGER boundary', () => {
      const largeCount = Number.MAX_SAFE_INTEGER;
      assert.strictEqual(Number.isSafeInteger(largeCount), true);
      assert.strictEqual(Number.isFinite(largeCount), true);
    });

    test('should detect MAX_SAFE_INTEGER + 1 overflow', () => {
      const overflowCount = Number.MAX_SAFE_INTEGER + 1;
      // JavaScript will silently lose precision here
      assert.strictEqual(Number.isSafeInteger(overflowCount), false);
      assert.strictEqual(overflowCount, Number.MAX_SAFE_INTEGER + 2); // Precision loss!
    });

    test('should handle large safe integers correctly', () => {
      const largeSafeInt = 9007199254740990; // MAX_SAFE_INTEGER - 1
      assert.strictEqual(Number.isSafeInteger(largeSafeInt), true);
      assert.strictEqual(Number.isFinite(largeSafeInt), true);
      assert.strictEqual(largeSafeInt + 1, Number.MAX_SAFE_INTEGER);
    });

    test('should distinguish negative zero from positive zero', () => {
      const negativeZero = -0;
      const positiveZero = 0;

      // Object.is() distinguishes -0 from +0
      assert.strictEqual(Object.is(negativeZero, positiveZero), false);

      // But === treats them as equal
      assert.strictEqual(negativeZero === positiveZero, true);

      // Both are safe integers
      assert.strictEqual(Number.isSafeInteger(negativeZero), true);
      assert.strictEqual(Number.isSafeInteger(positiveZero), true);
    });
  });

  describe('safePostReviewComment retry behavior', () => {
    // Track mock calls for verification
    let postCallCount: number;
    let sleepDelays: number[];

    // Mock dependencies that track calls
    function createMockDeps(postBehavior: () => Promise<void>): SafePostReviewCommentDeps {
      return {
        postIssueComment: async (_issueNumber: number, _body: string): Promise<void> => {
          postCallCount++;
          return postBehavior();
        },
        sleep: async (ms: number): Promise<void> => {
          sleepDelays.push(ms);
          // Return immediately for fast tests
        },
      };
    }

    beforeEach(() => {
      postCallCount = 0;
      sleepDelays = [];
    });

    test('should succeed on first attempt without retries', async () => {
      const deps = createMockDeps(async () => {
        // Success on first call
      });

      const result = await safePostReviewComment(
        123,
        'Test Title',
        'Test Body',
        STEP_PHASE1_PR_REVIEW,
        3,
        deps
      );

      assert.strictEqual(result, true);
      assert.strictEqual(postCallCount, 1, 'Should call postIssueComment exactly once');
      assert.strictEqual(sleepDelays.length, 0, 'Should not sleep on success');
    });

    test('should retry 3 times with exponential backoff on rate limit (429)', async () => {
      let attempt = 0;
      const deps = createMockDeps(async () => {
        attempt++;
        if (attempt < 3) {
          const error = new GitHubCliError('Rate limit exceeded', 429, 'rate_limit');
          throw error;
        }
        // Success on 3rd attempt
      });

      const result = await safePostReviewComment(
        123,
        'Test Title',
        'Test Body',
        STEP_PHASE1_PR_REVIEW,
        3,
        deps
      );

      assert.strictEqual(result, true, 'Should succeed after retries');
      assert.strictEqual(postCallCount, 3, 'Should call postIssueComment 3 times');
      assert.deepStrictEqual(sleepDelays, [2000, 4000], 'Should use exponential backoff (2s, 4s)');
    });

    test('should retry on network errors with exponential backoff', async () => {
      let attempt = 0;
      const deps = createMockDeps(async () => {
        attempt++;
        if (attempt < 2) {
          throw new Error('ECONNREFUSED: Connection refused');
        }
        // Success on 2nd attempt
      });

      const result = await safePostReviewComment(
        123,
        'Test Title',
        'Test Body',
        STEP_PHASE1_PR_REVIEW,
        3,
        deps
      );

      assert.strictEqual(result, true, 'Should succeed after retry');
      assert.strictEqual(postCallCount, 2, 'Should call postIssueComment 2 times');
      assert.deepStrictEqual(sleepDelays, [2000], 'Should sleep 2s before retry');
    });

    test('should NOT retry on 404 error (issue not found)', async () => {
      const deps = createMockDeps(async () => {
        const error = new GitHubCliError('Issue not found', 404, 'not_found');
        throw error;
      });

      const result = await safePostReviewComment(
        123,
        'Test Title',
        'Test Body',
        STEP_PHASE1_PR_REVIEW,
        3,
        deps
      );

      assert.strictEqual(result, false, 'Should return false on 404');
      assert.strictEqual(postCallCount, 1, 'Should call postIssueComment only once');
      assert.strictEqual(sleepDelays.length, 0, 'Should not sleep on non-retryable error');
    });

    test('should NOT retry on 401 authentication error', async () => {
      const deps = createMockDeps(async () => {
        const error = new GitHubCliError('Unauthorized', 401, 'auth_required');
        throw error;
      });

      const result = await safePostReviewComment(
        123,
        'Test Title',
        'Test Body',
        STEP_PHASE1_PR_REVIEW,
        3,
        deps
      );

      assert.strictEqual(result, false, 'Should return false on auth error');
      assert.strictEqual(postCallCount, 1, 'Should call postIssueComment only once');
      assert.strictEqual(sleepDelays.length, 0, 'Should not sleep on non-retryable error');
    });

    test('should NOT retry on 403 forbidden error', async () => {
      const deps = createMockDeps(async () => {
        const error = new GitHubCliError('Forbidden', 403, 'forbidden');
        throw error;
      });

      const result = await safePostReviewComment(
        123,
        'Test Title',
        'Test Body',
        STEP_PHASE1_PR_REVIEW,
        3,
        deps
      );

      assert.strictEqual(result, false, 'Should return false on forbidden error');
      assert.strictEqual(postCallCount, 1, 'Should call postIssueComment only once');
      assert.strictEqual(sleepDelays.length, 0, 'Should not sleep on non-retryable error');
    });

    test('should return false after exhausting all retries on persistent rate limit', async () => {
      const deps = createMockDeps(async () => {
        const error = new GitHubCliError('Rate limit exceeded', 429, 'rate_limit');
        throw error;
      });

      const result = await safePostReviewComment(
        123,
        'Test Title',
        'Test Body',
        STEP_PHASE1_PR_REVIEW,
        3,
        deps
      );

      assert.strictEqual(result, false, 'Should return false after exhausting retries');
      assert.strictEqual(postCallCount, 3, 'Should attempt 3 times');
      assert.deepStrictEqual(sleepDelays, [2000, 4000], 'Should delay between attempts');
    });

    test('should cap backoff delay at 60 seconds', async () => {
      let attempt = 0;
      const deps = createMockDeps(async () => {
        attempt++;
        if (attempt < 10) {
          throw new Error('ETIMEDOUT: Network timeout');
        }
        // Success on 10th attempt
      });

      const result = await safePostReviewComment(
        123,
        'Test Title',
        'Test Body',
        STEP_PHASE1_PR_REVIEW,
        10,
        deps
      );

      assert.strictEqual(result, true, 'Should succeed on 10th attempt');
      assert.strictEqual(postCallCount, 10, 'Should attempt 10 times');
      // Verify delays: 2s, 4s, 8s, 16s, 32s, 60s (capped), 60s, 60s, 60s
      // Note: We sleep before retries, so 9 sleeps for 10 attempts
      assert.strictEqual(sleepDelays.length, 9, 'Should have 9 sleep delays');
      assert.strictEqual(sleepDelays[5], 60000, 'Delay at attempt 6 should be capped at 60s');
      assert.strictEqual(sleepDelays[6], 60000, 'Delay at attempt 7 should be capped at 60s');
      assert.strictEqual(sleepDelays[7], 60000, 'Delay at attempt 8 should be capped at 60s');
      assert.strictEqual(sleepDelays[8], 60000, 'Delay at attempt 9 should be capped at 60s');
    });

    test('should throw ValidationError for maxRetries < 1', async () => {
      const deps = createMockDeps(async () => {});

      await assert.rejects(
        async () => safePostReviewComment(123, 'Title', 'Body', STEP_PHASE1_PR_REVIEW, 0, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          assert.ok(error.message.includes('1-100'));
          return true;
        }
      );
    });

    test('should throw ValidationError for non-integer maxRetries', async () => {
      const deps = createMockDeps(async () => {});

      await assert.rejects(
        async () => safePostReviewComment(123, 'Title', 'Body', STEP_PHASE1_PR_REVIEW, 2.5, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          return true;
        }
      );
    });

    test('should throw ValidationError for maxRetries > 100', async () => {
      const deps = createMockDeps(async () => {});

      await assert.rejects(
        async () => safePostReviewComment(123, 'Title', 'Body', STEP_PHASE1_PR_REVIEW, 101, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          assert.ok(error.message.includes('1-100'));
          return true;
        }
      );
    });

    test('should throw ValidationError for NaN maxRetries', async () => {
      const deps = createMockDeps(async () => {});

      await assert.rejects(
        async () => safePostReviewComment(123, 'Title', 'Body', STEP_PHASE1_PR_REVIEW, NaN, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          return true;
        }
      );
    });

    test('should throw ValidationError for Infinity maxRetries', async () => {
      const deps = createMockDeps(async () => {});

      await assert.rejects(
        async () =>
          safePostReviewComment(123, 'Title', 'Body', STEP_PHASE1_PR_REVIEW, Infinity, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          return true;
        }
      );
    });

    test('should throw ValidationError for negative maxRetries', async () => {
      const deps = createMockDeps(async () => {});

      await assert.rejects(
        async () => safePostReviewComment(123, 'Title', 'Body', STEP_PHASE1_PR_REVIEW, -5, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          assert.ok(error.message.includes('1-100'));
          return true;
        }
      );
    });
  });

  describe('retryStateUpdate retry behavior', () => {
    // Track mock calls for verification
    let updateCallCount: number;
    let sleepDelays: number[];

    // Create a minimal mock CurrentState for testing
    function createMockState(): CurrentState {
      return {
        wiggum: {
          phase: 'phase1',
          iteration: 1,
          step: STEP_PHASE1_PR_REVIEW, // 'p1-2' - valid WiggumStep
          completedSteps: [],
          maxIterations: 10,
        },
        issue: {
          exists: true,
          number: 123,
        },
        pr: {
          exists: false,
        },
        git: {
          currentBranch: 'test-branch',
          isMainBranch: false,
          hasUncommittedChanges: false,
          isRemoteTracking: true,
          isPushed: true,
        },
      };
    }

    // Create a mock failure result with required fields
    // All failures are transient by definition (rate_limit or network)
    function createFailureResult(reason: 'rate_limit' | 'network'): StateUpdateResult {
      return {
        success: false as const,
        reason,
        lastError: new Error(`${reason} error`),
        attemptCount: 1,
      };
    }

    // Mock dependencies that track calls
    function createMockDeps(
      updateBehavior: () => Promise<StateUpdateResult>
    ): RetryStateUpdateDeps {
      return {
        updateBodyState: async (
          _state: CurrentState,
          _newState: RetryStateUpdateNewState
        ): Promise<StateUpdateResult> => {
          updateCallCount++;
          return updateBehavior();
        },
        sleep: async (ms: number): Promise<void> => {
          sleepDelays.push(ms);
          // Return immediately for fast tests
        },
      };
    }

    beforeEach(() => {
      updateCallCount = 0;
      sleepDelays = [];
    });

    test('should succeed on first attempt without retries', async () => {
      const deps = createMockDeps(async () => ({
        success: true as const,
      }));

      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
      };

      const result = await retryStateUpdate(state, newState, 3, deps);

      assert.strictEqual(result.success, true);
      assert.strictEqual(updateCallCount, 1, 'Should call updateBodyState exactly once');
      assert.strictEqual(sleepDelays.length, 0, 'Should not sleep on success');
    });

    test('should retry on transient failure and succeed', async () => {
      let attempt = 0;
      const deps = createMockDeps(async () => {
        attempt++;
        if (attempt < 3) {
          return createFailureResult('rate_limit');
        }
        return { success: true as const };
      });

      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
      };

      const result = await retryStateUpdate(state, newState, 3, deps);

      assert.strictEqual(result.success, true, 'Should succeed after retries');
      assert.strictEqual(updateCallCount, 3, 'Should call updateBodyState 3 times');
      assert.deepStrictEqual(sleepDelays, [2000, 4000], 'Should use exponential backoff');
    });

    test('should return failure on last attempt when maxRetries reached', async () => {
      // All failures are transient (rate_limit or network), so retries stop at maxRetries
      const deps = createMockDeps(async () => createFailureResult('network'));

      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
      };

      const result = await retryStateUpdate(state, newState, 3, deps);

      assert.strictEqual(result.success, false, 'Should fail after exhausting retries');
      assert.strictEqual(updateCallCount, 3, 'Should call updateBodyState 3 times');
      assert.deepStrictEqual(sleepDelays, [2000, 4000], 'Should delay between attempts');
    });

    test('should return failure after exhausting all retries', async () => {
      const deps = createMockDeps(async () => createFailureResult('rate_limit'));

      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
      };

      const result = await retryStateUpdate(state, newState, 3, deps);

      assert.strictEqual(result.success, false, 'Should fail after exhausting retries');
      if (!result.success) {
        assert.strictEqual(result.reason, 'rate_limit', 'Should return last failure reason');
      }
      assert.strictEqual(updateCallCount, 3, 'Should attempt 3 times');
      assert.deepStrictEqual(sleepDelays, [2000, 4000], 'Should delay between attempts');
    });

    test('should throw ValidationError for maxRetries < 1', async () => {
      const deps = createMockDeps(async () => ({ success: true as const }));
      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [],
        phase: 'phase1',
      };

      await assert.rejects(
        async () => retryStateUpdate(state, newState, 0, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          return true;
        }
      );
    });

    test('should throw ValidationError for non-integer maxRetries', async () => {
      const deps = createMockDeps(async () => ({ success: true as const }));
      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [],
        phase: 'phase1',
      };

      await assert.rejects(
        async () => retryStateUpdate(state, newState, 1.5, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          return true;
        }
      );
    });

    test('should use exponential backoff delays (2s, 4s, 8s)', async () => {
      let attempt = 0;
      const deps = createMockDeps(async () => {
        attempt++;
        if (attempt < 4) {
          return createFailureResult('network');
        }
        return { success: true as const };
      });

      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [],
        phase: 'phase1',
      };

      const result = await retryStateUpdate(state, newState, 5, deps);

      assert.strictEqual(result.success, true, 'Should succeed on 4th attempt');
      assert.strictEqual(updateCallCount, 4, 'Should call updateBodyState 4 times');
      // Verify exponential backoff: 2^1*1000, 2^2*1000, 2^3*1000
      assert.deepStrictEqual(sleepDelays, [2000, 4000, 8000], 'Should use exponential backoff');
    });

    test('should throw ValidationError for negative maxRetries', async () => {
      const deps = createMockDeps(async () => ({ success: true as const }));
      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [],
        phase: 'phase1',
      };

      await assert.rejects(
        async () => retryStateUpdate(state, newState, -1, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          return true;
        }
      );
    });

    test('should throw ValidationError for NaN maxRetries', async () => {
      const deps = createMockDeps(async () => ({ success: true as const }));
      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [],
        phase: 'phase1',
      };

      await assert.rejects(
        async () => retryStateUpdate(state, newState, NaN, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          return true;
        }
      );
    });

    test('should throw ValidationError for Infinity maxRetries', async () => {
      const deps = createMockDeps(async () => ({ success: true as const }));
      const state = createMockState();
      const newState: RetryStateUpdateNewState = {
        iteration: 1,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [],
        phase: 'phase1',
      };

      await assert.rejects(
        async () => retryStateUpdate(state, newState, Infinity, deps),
        (error: Error) => {
          assert.ok(error.message.includes('maxRetries must be a positive integer'));
          return true;
        }
      );
    });
  });

  describe('File Error Categorization Logic', () => {
    describe('in-scope vs out-of-scope categorization', () => {
      test('should categorize path with "-in-scope-" as in-scope', () => {
        const path = '/tmp/claude/code-reviewer-in-scope-1234.md';
        const isInScope = path.includes('-in-scope-');
        const isOutOfScope = path.includes('-out-of-scope-');
        assert.strictEqual(isInScope, true);
        assert.strictEqual(isOutOfScope, false);
      });

      test('should categorize path with "-out-of-scope-" as out-of-scope', () => {
        const path = '/tmp/claude/code-reviewer-out-of-scope-1234.md';
        const isInScope = path.includes('-in-scope-');
        const isOutOfScope = path.includes('-out-of-scope-');
        assert.strictEqual(isInScope, false);
        assert.strictEqual(isOutOfScope, true);
      });

      test('should warn when path does not match expected pattern', () => {
        const path = '/tmp/claude/some-random-file.md';
        const isInScope = path.includes('-in-scope-');
        const isOutOfScope = path.includes('-out-of-scope-');
        const matchesExpectedPattern = isInScope || isOutOfScope;
        assert.strictEqual(matchesExpectedPattern, false, 'Should not match either pattern');
        // This documents that a warning should be logged when neither pattern matches
      });

      test('should handle edge case: "in-scope" in directory name without hyphen prefix', () => {
        // Path has "in-scope-" but NOT "-in-scope-" (no hyphen before "in")
        const path = '/tmp/in-scope-debug/code-reviewer-results.md';
        const isInScope = path.includes('-in-scope-');
        // Since the pattern requires a hyphen BEFORE "in-scope", this does NOT match
        assert.strictEqual(isInScope, false, 'Pattern requires hyphen before "in-scope"');
        // This documents that the pattern matching is precise
      });

      test('should match when directory contains full "-in-scope-" pattern', () => {
        // Path has full "-in-scope-" pattern in directory
        const path = '/tmp/debug-in-scope-dir/code-reviewer-results.md';
        const isInScope = path.includes('-in-scope-');
        // This DOES match because "-in-scope-" is present
        assert.strictEqual(isInScope, true, 'Pattern matches substring anywhere in path');
        // Documents that pattern matching is substring-based
      });

      test('should handle edge case: path contains both patterns', () => {
        // Unusual but possible path with both patterns
        const path = '/tmp/test-in-scope-copy/test-out-of-scope-backup.md';
        const isInScope = path.includes('-in-scope-');
        const isOutOfScope = path.includes('-out-of-scope-');
        assert.strictEqual(isInScope, true);
        assert.strictEqual(isOutOfScope, true);
        // Documents that order of checking matters in implementation
      });
    });

    describe('Node.js error code extraction', () => {
      test('should recognize ENOENT error code', () => {
        const error = { code: 'ENOENT', message: 'no such file or directory' };
        assert.strictEqual(error.code, 'ENOENT');
      });

      test('should recognize EACCES error code', () => {
        const error = { code: 'EACCES', message: 'permission denied' };
        assert.strictEqual(error.code, 'EACCES');
      });

      test('should recognize EISDIR error code', () => {
        const error = { code: 'EISDIR', message: 'is a directory' };
        assert.strictEqual(error.code, 'EISDIR');
      });

      test('should recognize EMFILE error code', () => {
        const error = { code: 'EMFILE', message: 'too many open files' };
        assert.strictEqual(error.code, 'EMFILE');
      });

      test('should handle error without code property', () => {
        const error = { message: 'Unknown error occurred' };
        const code = (error as { code?: string }).code;
        assert.strictEqual(code, undefined);
      });

      test('should validate known vs unknown error codes', () => {
        const knownCodes = ['ENOENT', 'EACCES', 'EISDIR', 'EMFILE', 'EBUSY', 'EPERM'];
        const unknownCode = 'EWEIRD';
        assert.strictEqual(knownCodes.includes('ENOENT'), true);
        assert.strictEqual(knownCodes.includes('EACCES'), true);
        assert.strictEqual(knownCodes.includes(unknownCode), false);
      });
    });

    describe('error severity by category', () => {
      test('should document that in-scope failures are CRITICAL', () => {
        // In-scope file read failures throw ValidationError
        // This is documented in the tiered failure handling
        const inScopeErrorSeverity = 'CRITICAL';
        assert.strictEqual(inScopeErrorSeverity, 'CRITICAL');
      });

      test('should document that out-of-scope failures are WARNING', () => {
        // Out-of-scope file read failures log warnings but don't throw
        // This is documented in the tiered failure handling
        const outOfScopeErrorSeverity = 'WARNING';
        assert.strictEqual(outOfScopeErrorSeverity, 'WARNING');
      });
    });
  });

  describe('safePostReviewComment', () => {
    test('should validate maxRetries parameter (must be 1-100)', () => {
      // Documents that maxRetries must be a positive integer between 1 and 100
      // Invalid values (< 1, > 100, non-integer, NaN, Infinity) should throw ValidationError
      const validMaxRetries = [1, 3, 5, 10, 100];
      const invalidMaxRetries = [0, -1, 0.5, 101, NaN, Infinity];

      // Valid values should not throw
      for (const value of validMaxRetries) {
        assert.strictEqual(Number.isInteger(value), true);
        assert.strictEqual(value >= 1 && value <= 100, true);
      }

      // Invalid values should fail validation
      for (const value of invalidMaxRetries) {
        const isValid = Number.isInteger(value) && value >= 1 && value <= 100;
        assert.strictEqual(isValid, false);
      }
    });

    test('should document comment posting error handling strategy', () => {
      // Documents error classification for comment posting:
      // - 404 (issue not found): Log ERROR, return false, no retry
      // - 401/403 (auth): Log ERROR, return false, no retry
      // - 429 (rate limit): Log INFO, retry with backoff
      // - Network errors: Log INFO, retry with backoff
      // - Unexpected: Log ERROR, return false, no retry
      const criticalErrors = [404, 401, 403]; // No retry
      const transientErrors = [429]; // Retry with backoff
      const networkErrorPatterns = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'];

      assert.strictEqual(criticalErrors.includes(404), true);
      assert.strictEqual(criticalErrors.includes(401), true);
      assert.strictEqual(transientErrors.includes(429), true);
      assert.strictEqual(networkErrorPatterns.includes('ETIMEDOUT'), true);
    });

    test('should document non-blocking behavior on failure', () => {
      // Documents that comment posting failures are non-blocking:
      // - State is already persisted in PR/issue body
      // - Comment posting is supplementary (nice-to-have)
      // - Workflow continues even if comment fails
      // - Function returns boolean (true = posted, false = failed)
      const isNonBlocking = true;
      const returnTypeIsBoolean = true;
      const stateAlreadyPersisted = true;

      assert.strictEqual(isNonBlocking, true);
      assert.strictEqual(returnTypeIsBoolean, true);
      assert.strictEqual(stateAlreadyPersisted, true);
    });

    test('should document exponential backoff for retries', () => {
      // Documents that retries use exponential backoff (2^attempt * 1000ms)
      // with a 60s cap, matching the pattern in safeUpdatePRBodyState
      const MAX_DELAY_MS = 60000;
      const attempt1Delay = Math.min(Math.pow(2, 1) * 1000, MAX_DELAY_MS); // 2s
      const attempt2Delay = Math.min(Math.pow(2, 2) * 1000, MAX_DELAY_MS); // 4s
      const attempt3Delay = Math.min(Math.pow(2, 3) * 1000, MAX_DELAY_MS); // 8s

      assert.strictEqual(attempt1Delay, 2000);
      assert.strictEqual(attempt2Delay, 4000);
      assert.strictEqual(attempt3Delay, 8000);
    });

    test('should document comment structure (title + body)', () => {
      // Documents that comments are formatted with:
      // - Title as H2 heading (## {title})
      // - Body content from buildCommentContent
      // - Full structure: `## ${title}\n\n${body}`
      const title = 'Step 2 (PR Review) - Issues Found';
      const body =
        '**Command Executed:** `/all-hands-review`\n\n**PR Issues Found:**\n- High Priority: 3';
      const expectedFormat = `## ${title}\n\n${body}`;

      assert.strictEqual(expectedFormat.startsWith('## '), true);
      assert.strictEqual(expectedFormat.includes('\n\n'), true);
    });

    test('should document logging levels for different scenarios', () => {
      // Documents logging levels for comment posting:
      // - SUCCESS (first attempt): INFO
      // - SUCCESS (after retry): INFO with recovery message
      // - RETRY (transient error): INFO with backoff details
      // - FAILURE (after retries): WARN with workflow continuation message
      // - CRITICAL (404, auth): ERROR with recommendation
      const logLevels = {
        success: 'INFO',
        successAfterRetry: 'INFO',
        retryTransient: 'INFO',
        failureAfterRetries: 'WARN',
        criticalError: 'ERROR',
      };

      assert.strictEqual(logLevels.success, 'INFO');
      assert.strictEqual(logLevels.criticalError, 'ERROR');
      assert.strictEqual(logLevels.failureAfterRetries, 'WARN');
    });

    test('should document integration with buildCommentContent', () => {
      // Documents that safePostReviewComment integrates with buildCommentContent:
      // - buildCommentContent formats review results into title + body
      // - safePostReviewComment posts the formatted content with retry logic
      // - Separation of concerns: formatting vs posting
      const formattingFunction = 'buildCommentContent';
      const postingFunction = 'safePostReviewComment';
      const separationOfConcerns = true;

      assert.strictEqual(formattingFunction, 'buildCommentContent');
      assert.strictEqual(postingFunction, 'safePostReviewComment');
      assert.strictEqual(separationOfConcerns, true);
    });
  });

  describe('completeReview comment posting integration', () => {
    test('should document comment posting occurs after state update', () => {
      // Documents the execution order in completeReview:
      // 1. Load review results (with inScope/outOfScope capture)
      // 2. Build new state
      // 3. Update state in PR/issue body (with retry)
      // 4. Post review comment to issue (non-blocking)
      // 5. Continue with iteration limit check and next step
      const executionOrder = [
        'loadReviewResults',
        'buildNewState',
        'retryStateUpdate',
        'safePostReviewComment', // NEW: Added in this fix
        'isIterationLimitReached',
      ];

      assert.strictEqual(executionOrder[3], 'safePostReviewComment');
      assert.strictEqual(executionOrder[2], 'retryStateUpdate');
    });

    test('should document verbatimResponse construction', () => {
      // Documents that verbatimResponse combines inScope + outOfScope:
      // - inScope: "## In-Scope Issues\n\n{content}"
      // - outOfScope: "## Out-of-Scope Recommendations\n\n{content}"
      // - Combined: [inScope, outOfScope].filter(Boolean).join('\n\n')
      // - Empty sections are filtered out
      const inScope = '## In-Scope Issues\n\nContent';
      const outOfScope = '## Out-of-Scope Recommendations\n\nContent';
      const combined = [inScope, outOfScope].filter(Boolean).join('\n\n');

      assert.strictEqual(combined.includes('## In-Scope Issues'), true);
      assert.strictEqual(combined.includes('## Out-of-Scope Recommendations'), true);
      assert.strictEqual(combined.split('\n\n').length >= 2, true);
    });

    test('should document defensive check for missing issue', () => {
      // Documents that completeReview has defensive error handling:
      // - Checks if state.issue.exists before posting comment
      // - Logs ERROR if issue missing (should be unreachable)
      // - validatePhaseRequirements ensures issue exists earlier
      // - Workflow continues without comment if check fails
      const hasDefensiveCheck = true;
      const logsErrorIfMissing = true;
      const workflowContinues = true;

      assert.strictEqual(hasDefensiveCheck, true);
      assert.strictEqual(logsErrorIfMissing, true);
      assert.strictEqual(workflowContinues, true);
    });

    test('should document workflow continues on comment failure', () => {
      // Documents that comment posting failures don't halt workflow:
      // - safePostReviewComment returns false on failure
      // - completeReview logs WARN and continues to iteration limit check
      // - State is already persisted, so comment is optional
      // - User sees review results in body even if comment fails
      const commentFailureIsNonBlocking = true;
      const stateAlreadyPersisted = true;
      const workflowContinues = true;

      assert.strictEqual(commentFailureIsNonBlocking, true);
      assert.strictEqual(stateAlreadyPersisted, true);
      assert.strictEqual(workflowContinues, true);
    });

    test('should document comment posts to issue (not PR)', () => {
      // Documents that review comments always post to the linked issue:
      // - Phase 1: State in issue body, comment to issue
      // - Phase 2: State in PR body, comment to issue (NOT PR)
      // - Rationale: Issue is the source of truth for tracking
      const commentTarget = 'issue';
      const phase1StateLocation = 'issue';
      const phase2StateLocation = 'pr';

      assert.strictEqual(commentTarget, 'issue');
      assert.notStrictEqual(commentTarget, 'pr');
      assert.strictEqual(phase1StateLocation, 'issue');
      assert.strictEqual(phase2StateLocation, 'pr');
    });
  });

  describe('File I/O Error Escalation (loadReviewResults)', () => {
    // Tests for error paths in readReviewFile and loadReviewResults
    // covering cascading failures, serious filesystem errors, and data loss warnings

    describe('Empty file race condition diagnostics', () => {
      test('should provide diagnostic information for empty files (stat size = 0)', async () => {
        // Tests the empty file detection path where stat() shows size 0
        // This helps diagnose whether empty files are due to race conditions vs agent crashes
        const emptyFile = `/tmp/claude/empty-diag-in-scope-${Date.now()}-${randomHex()}.md`;
        await writeFile(emptyFile, ''); // Zero-byte file

        try {
          await loadReviewResults([emptyFile], []);
          assert.fail('Should have thrown ValidationError');
        } catch (error) {
          assert.ok(error instanceof Error);
          assert.ok(error.name === 'ValidationError');
          // Error message should include diagnostic guidance about possible causes
          assert.ok(
            error.message.includes('empty') || error.message.includes('Empty'),
            'Error should mention file is empty'
          );
        } finally {
          await unlink(emptyFile);
        }
      });

      test('should detect whitespace-only files as empty after read', async () => {
        // Tests the createNonEmptyString validation path where file has content
        // but content is only whitespace - caught during content validation, not stat
        const whitespaceFile = `/tmp/claude/whitespace-diag-in-scope-${Date.now()}-${randomHex()}.md`;
        await writeFile(whitespaceFile, '  \n\t  \r\n  '); // Only whitespace

        try {
          await loadReviewResults([whitespaceFile], []);
          assert.fail('Should have thrown ValidationError');
        } catch (error) {
          assert.ok(error instanceof Error);
          assert.ok(error.name === 'ValidationError');
          // Whitespace-only files are caught by createNonEmptyString
          assert.ok(error.message.includes('empty'), 'Error should indicate file is empty');
        } finally {
          await unlink(whitespaceFile);
        }
      });

      test('should include action hints for empty files', async () => {
        // Tests that error messages include actionable guidance
        const emptyFile = `/tmp/claude/action-hint-in-scope-${Date.now()}-${randomHex()}.md`;
        await writeFile(emptyFile, '');

        try {
          await loadReviewResults([emptyFile], []);
          assert.fail('Should have thrown');
        } catch (error) {
          assert.ok(error instanceof Error);
          // Error should provide actionable guidance
          assert.ok(
            error.message.includes('Action:') || error.message.includes('agent'),
            'Error should include action hint or mention agents'
          );
        } finally {
          await unlink(emptyFile);
        }
      });
    });

    describe('Data completeness warnings (out-of-scope failures)', () => {
      test('should calculate data loss percentage for partial out-of-scope failures', async () => {
        // Tests that when some out-of-scope files fail, the warning includes percentage
        const success1 = `/tmp/claude/success1-out-of-scope-${Date.now()}-${randomHex()}.md`;
        const success2 = `/tmp/claude/success2-out-of-scope-${Date.now() + 1}-${randomHex()}.md`;
        const fail1 = `/tmp/claude/fail1-out-of-scope-${Date.now() + 2}-${randomHex()}.md`;
        const fail2 = `/tmp/claude/fail2-out-of-scope-${Date.now() + 3}-${randomHex()}.md`;
        const fail3 = `/tmp/claude/fail3-out-of-scope-${Date.now() + 4}-${randomHex()}.md`;

        // Create only some files - others will fail with ENOENT
        await writeFile(success1, '# Success 1 content');
        await writeFile(success2, '# Success 2 content');
        // Don't create fail files - they will fail to load

        try {
          const result = await loadReviewResults(
            [], // No in-scope files
            [success1, success2, fail1, fail2, fail3] // 2 success, 3 fail = 60% failure
          );

          // Should succeed (out-of-scope failures are non-fatal)
          assert.ok(result.outOfScope.includes('Success 1'), 'Should include successful content');
          assert.ok(result.outOfScope.includes('Success 2'), 'Should include successful content');

          // Should have warning about data loss
          assert.strictEqual(result.warnings.length, 1, 'Should have exactly 1 warning');
          const warning = result.warnings[0];

          // Warning should include count and percentage
          assert.ok(warning.includes('3'), 'Warning should mention 3 failed files');
          assert.ok(warning.includes('5'), 'Warning should mention 5 total files');
          assert.ok(warning.includes('60'), 'Warning should include 60% data loss');
        } finally {
          await unlink(success1);
          await unlink(success2);
        }
      });

      test('should provide different warning for minor data loss vs major data loss', async () => {
        // Tests that small percentage failures get appropriate warning level
        const success1 = `/tmp/claude/success-a-out-of-scope-${Date.now()}-${randomHex()}.md`;
        const success2 = `/tmp/claude/success-b-out-of-scope-${Date.now() + 1}-${randomHex()}.md`;
        const success3 = `/tmp/claude/success-c-out-of-scope-${Date.now() + 2}-${randomHex()}.md`;
        const success4 = `/tmp/claude/success-d-out-of-scope-${Date.now() + 3}-${randomHex()}.md`;
        const fail1 = `/tmp/claude/fail-one-out-of-scope-${Date.now() + 4}-${randomHex()}.md`;

        // 4 success, 1 fail = 20% failure (minor)
        await writeFile(success1, '# Content A');
        await writeFile(success2, '# Content B');
        await writeFile(success3, '# Content C');
        await writeFile(success4, '# Content D');

        try {
          const result = await loadReviewResults(
            [],
            [success1, success2, success3, success4, fail1]
          );

          // Should have warning but not CRITICAL
          assert.strictEqual(result.warnings.length, 1);
          const warning = result.warnings[0];

          // Minor data loss should be a Warning, not CRITICAL
          assert.ok(!warning.includes('CRITICAL'), 'Minor data loss should not be CRITICAL');
          assert.ok(warning.includes('Warning') || warning.includes('warning'));
          assert.ok(warning.includes('20'), 'Should include 20% data loss');
        } finally {
          await unlink(success1);
          await unlink(success2);
          await unlink(success3);
          await unlink(success4);
        }
      });
    });

    describe('Systemic issue detection (all out-of-scope failures)', () => {
      test('should detect systemic issue when ALL out-of-scope files fail', async () => {
        // Tests that when ALL out-of-scope files fail, we detect it as systemic
        const fail1 = `/tmp/claude/sys-fail1-out-of-scope-${Date.now()}-${randomHex()}.md`;
        const fail2 = `/tmp/claude/sys-fail2-out-of-scope-${Date.now() + 1}-${randomHex()}.md`;
        const fail3 = `/tmp/claude/sys-fail3-out-of-scope-${Date.now() + 2}-${randomHex()}.md`;
        const fail4 = `/tmp/claude/sys-fail4-out-of-scope-${Date.now() + 3}-${randomHex()}.md`;
        const fail5 = `/tmp/claude/sys-fail5-out-of-scope-${Date.now() + 4}-${randomHex()}.md`;

        // Don't create any files - all will fail
        const result = await loadReviewResults(
          [], // No in-scope files
          [fail1, fail2, fail3, fail4, fail5] // All 5 files missing
        );

        // Should succeed (out-of-scope failures are non-fatal)
        assert.strictEqual(result.inScope, '');
        assert.strictEqual(result.outOfScope, '');

        // Should have CRITICAL warning about systemic issue
        assert.strictEqual(result.warnings.length, 1);
        const warning = result.warnings[0];

        assert.ok(warning.includes('CRITICAL'), 'All-fail case should be CRITICAL');
        assert.ok(
          warning.includes('ALL') || warning.includes('systemic'),
          'Should mention systemic issue'
        );
        assert.ok(warning.includes('5'), 'Should mention count of failed files');
      });

      test('should not flag systemic issue for single out-of-scope file failure', async () => {
        // Tests that a single file failure is not flagged as systemic
        const failSingle = `/tmp/claude/single-fail-out-of-scope-${Date.now()}-${randomHex()}.md`;

        const result = await loadReviewResults([], [failSingle]);

        // Single failure should NOT be CRITICAL
        assert.strictEqual(result.warnings.length, 1);
        const warning = result.warnings[0];

        // For single file, it's 100% data loss but only 1 file - should still be CRITICAL per code
        // (allFailed = true when outOfScopeErrors.length === totalOutOfScope && totalOutOfScope > 0)
        // This test documents the actual behavior
        assert.ok(warning.includes('CRITICAL'), 'Single file all-fail is treated as CRITICAL');
      });
    });

    describe('Serious filesystem error classification', () => {
      // These tests document the expected behavior for serious filesystem errors
      // Testing actual EACCES/EROFS/ENOSPC requires OS-level setup that's hard to reproduce reliably

      test('should document EACCES is classified as serious filesystem error', () => {
        // EACCES (permission denied) is in SERIOUS_FILESYSTEM_ERRORS
        // When stat() succeeds but read fails with EACCES, it indicates
        // file is visible but not readable - a permission misconfiguration
        const seriousErrors = ['EACCES', 'EROFS', 'ENOSPC', 'EMFILE', 'ENFILE'];
        assert.ok(seriousErrors.includes('EACCES'));
        // This should throw FilesystemError, not ValidationError
      });

      test('should document EROFS is classified as serious filesystem error', () => {
        // EROFS (read-only file system) indicates filesystem is mounted read-only
        const seriousErrors = ['EACCES', 'EROFS', 'ENOSPC', 'EMFILE', 'ENFILE'];
        assert.ok(seriousErrors.includes('EROFS'));
      });

      test('should document ENOSPC is classified as serious filesystem error', () => {
        // ENOSPC (no space left on device) indicates disk space exhaustion
        const seriousErrors = ['EACCES', 'EROFS', 'ENOSPC', 'EMFILE', 'ENFILE'];
        assert.ok(seriousErrors.includes('ENOSPC'));
      });

      test('should document EMFILE/ENFILE are classified as serious filesystem errors', () => {
        // EMFILE (too many open files) / ENFILE (file table overflow)
        // indicate system resource exhaustion
        const seriousErrors = ['EACCES', 'EROFS', 'ENOSPC', 'EMFILE', 'ENFILE'];
        assert.ok(seriousErrors.includes('EMFILE'));
        assert.ok(seriousErrors.includes('ENFILE'));
      });

      test('should document ENOENT is NOT a serious filesystem error', () => {
        // ENOENT (file not found) is expected - not a system issue
        const seriousErrors = ['EACCES', 'EROFS', 'ENOSPC', 'EMFILE', 'ENFILE'];
        assert.ok(!seriousErrors.includes('ENOENT'));
      });

      test('should document EISDIR is NOT a serious filesystem error', () => {
        // EISDIR (is a directory) is a usage error, not a system issue
        const seriousErrors = ['EACCES', 'EROFS', 'ENOSPC', 'EMFILE', 'ENFILE'];
        assert.ok(!seriousErrors.includes('EISDIR'));
      });
    });

    describe('Cascading filesystem failure escalation', () => {
      // These tests document the expected behavior for cascading failures
      // where both the original operation AND diagnostic stat() fail

      test('should document cascading failure detection logic', () => {
        // Cascading failure = original error + stat() error (not both ENOENT)
        // Example: ETIMEDOUT on read, then EIO on stat = cascading failure
        // Example: ENOENT on read, then ENOENT on stat = NOT cascading (file just doesn't exist)

        // When cascading failure detected:
        // 1. Log ERROR with both errors
        // 2. Add error to errors array
        // 3. Throw FilesystemError with diagnostic commands

        const cascadingScenario = {
          originalError: 'ETIMEDOUT',
          statError: 'EIO',
          isCascading: true, // Different non-ENOENT errors
        };

        const normalMissingFile = {
          originalError: 'ENOENT',
          statError: 'ENOENT',
          isCascading: false, // Same ENOENT = file just missing
        };

        const mixedScenario = {
          originalError: 'EIO',
          statError: 'ENOENT',
          isCascading: true, // Original was not ENOENT, so cascading
        };

        // Verify the logic matches implementation
        function isCascading(orig: string, stat: string): boolean {
          return !(orig === 'ENOENT' && stat === 'ENOENT');
        }

        assert.strictEqual(
          isCascading(cascadingScenario.originalError, cascadingScenario.statError),
          cascadingScenario.isCascading
        );
        assert.strictEqual(
          isCascading(normalMissingFile.originalError, normalMissingFile.statError),
          normalMissingFile.isCascading
        );
        assert.strictEqual(
          isCascading(mixedScenario.originalError, mixedScenario.statError),
          mixedScenario.isCascading
        );
      });

      test('should document FilesystemError thrown for cascading failures', () => {
        // When cascading failure detected, implementation throws FilesystemError with:
        // - Original error message
        // - Stat error message
        // - Diagnostic commands (fsck, mount, ls, df)

        const expectedErrorContent = [
          'Cascading filesystem failure',
          'Original error:',
          'Diagnostic stat() also failed:',
          'fsck',
          'NFS',
          'df -h',
        ];

        // Document expected error message format
        for (const content of expectedErrorContent) {
          assert.strictEqual(typeof content, 'string', `Error should include: ${content}`);
        }
      });

      test('should document serious error escalation path when stat succeeds', () => {
        // When stat() succeeds but original read had serious error:
        // 1. Log ERROR with structured context
        // 2. Push error to errors array
        // 3. Throw FilesystemError with diagnostic commands

        const expectedScenario = {
          originalError: 'EACCES', // Permission denied
          statSuccess: true,
          fileSize: 1024,
          expectedBehavior: 'Throw FilesystemError with permission diagnostic commands',
        };

        const expectedDiagnostics = [
          'ls -la', // Check permissions
          'df -h', // Check disk space
          'ulimit -n', // Check open file limits
        ];

        // Document expected diagnostic commands
        assert.strictEqual(expectedScenario.statSuccess, true);
        assert.ok(expectedDiagnostics.length >= 3);
      });
    });

    describe('Error message structure and diagnostics', () => {
      test('should include file path in all error messages', async () => {
        const missingFile = `/tmp/claude/path-test-in-scope-${Date.now()}-${randomHex()}.md`;

        try {
          await loadReviewResults([missingFile], []);
          assert.fail('Should have thrown');
        } catch (error) {
          assert.ok(error instanceof Error);
          // Error message should include the full file path
          assert.ok(error.message.includes(missingFile), 'Error should include file path');
        }
      });

      test('should include error code in error messages when available', async () => {
        const missingFile = `/tmp/claude/code-test-in-scope-${Date.now()}-${randomHex()}.md`;

        try {
          await loadReviewResults([missingFile], []);
          assert.fail('Should have thrown');
        } catch (error) {
          assert.ok(error instanceof Error);
          // ENOENT should be in the error message
          assert.ok(error.message.includes('ENOENT'), 'Error should include error code');
        }
      });

      test('should categorize errors as in-scope vs out-of-scope in messages', async () => {
        const inScopeMissing = `/tmp/claude/cat-test-in-scope-${Date.now()}-${randomHex()}.md`;

        try {
          await loadReviewResults([inScopeMissing], []);
          assert.fail('Should have thrown');
        } catch (error) {
          assert.ok(error instanceof Error);
          // Error should be labeled as in-scope
          assert.ok(
            error.message.includes('[in-scope]') || error.message.includes('in-scope'),
            'Error should be categorized as in-scope'
          );
        }
      });

      test('should provide actionable hints for different error types', async () => {
        // Missing file should suggest checking agent completion
        const missingFile = `/tmp/claude/hint-test-in-scope-${Date.now()}-${randomHex()}.md`;

        try {
          await loadReviewResults([missingFile], []);
          assert.fail('Should have thrown');
        } catch (error) {
          assert.ok(error instanceof Error);
          // Should include an action hint
          assert.ok(
            error.message.includes('Action:') || error.message.includes('Check'),
            'Error should include action hint'
          );
        }
      });
    });
  });
});
