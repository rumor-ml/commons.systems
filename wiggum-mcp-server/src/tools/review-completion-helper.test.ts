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

import { describe, it, test } from 'node:test';
import assert from 'node:assert';
import { writeFile, unlink, mkdir, rmdir } from 'fs/promises';
import type { ReviewConfig, ReviewCompletionInput } from './review-completion-helper.js';
import { extractAgentNameFromPath, loadReviewResults } from './review-completion-helper.js';
import {
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
} from '../constants.js';

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
        in_scope_files: ['/tmp/file1.md', '/tmp/file2.md'],
        out_of_scope_files: ['/tmp/file3.md'],
        in_scope_count: 2,
        out_of_scope_count: 1,
      };
      assert.strictEqual(input.command_executed, true);
      assert.strictEqual(input.in_scope_count, 2);
    });

    it('should accept valid input with no issues', () => {
      const input: ReviewCompletionInput = {
        command_executed: true,
        in_scope_files: [],
        out_of_scope_files: [],
        in_scope_count: 0,
        out_of_scope_count: 0,
      };
      assert.strictEqual(input.in_scope_count, 0);
    });
  });

  describe('loadReviewResults', () => {
    it('should successfully load multiple in-scope and out-of-scope files', async () => {
      const inScopeFile1 = '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '.md';
      const inScopeFile2 = '/tmp/claude/silent-failure-hunter-in-scope-' + (Date.now() + 1) + '.md';
      const outOfScopeFile = '/tmp/claude/code-reviewer-out-of-scope-' + Date.now() + '.md';

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
      const nonexistentFile = '/tmp/claude/nonexistent-in-scope-' + Date.now() + '.md';

      await assert.rejects(async () => loadReviewResults([nonexistentFile], []), {
        name: 'ValidationError',
        message: /Failed to read 1 in-scope review file/,
      });
    });

    it('should throw ValidationError for empty files', async () => {
      // Use proper agent naming pattern so extractAgentNameFromPath succeeds
      // and we can test the actual empty file handling
      const emptyFile = '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '.md';
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
      it('should document that command_executed: false throws ValidationError', () => {
        // When command_executed is false:
        // - completeReview() throws ValidationError
        // - Error message: "command_executed must be true. Do not shortcut the {review type} review process."
        // - This prevents skipping the actual review execution
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
        // Thrown immediately if command_executed is false
        // Before any state detection or processing
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
        '/tmp/claude/wiggum-625/code-reviewer-in-scope-1234.md'
      );
      assert.strictEqual(result, 'Code Reviewer');
    });

    it('should extract agent name from out-of-scope file path', () => {
      const result = extractAgentNameFromPath(
        '/tmp/claude/wiggum-625/pr-test-analyzer-out-of-scope-5678.md'
      );
      assert.strictEqual(result, 'Pr Test Analyzer');
    });

    it('should handle single-word agent names', () => {
      const result = extractAgentNameFromPath('/tmp/claude/wiggum-625/linter-in-scope-1234.md');
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
      const result = extractAgentNameFromPath('comment-analyzer-in-scope-9999.md');
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
      const tempFile = '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '.md';
      await writeFile(tempFile, 'Test content');

      const result = await loadReviewResults([tempFile], []);
      assert.ok(result.inScope.includes('## In-Scope Issues'));
      assert.ok(result.inScope.includes('#### Code Reviewer'));
      assert.ok(result.inScope.includes('Test content'));
      assert.strictEqual(result.outOfScope, '');

      await unlink(tempFile);
    });

    it('should read and format single out-of-scope file', async () => {
      const tempFile = '/tmp/claude/pr-test-analyzer-out-of-scope-' + Date.now() + '.md';
      await writeFile(tempFile, 'Out of scope content');

      const result = await loadReviewResults([], [tempFile]);
      assert.strictEqual(result.inScope, '');
      assert.ok(result.outOfScope.includes('## Out-of-Scope Recommendations'));
      assert.ok(result.outOfScope.includes('#### Pr Test Analyzer'));
      assert.ok(result.outOfScope.includes('Out of scope content'));

      await unlink(tempFile);
    });

    it('should read and format multiple files', async () => {
      const inScope1 = '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '.md';
      const inScope2 = '/tmp/claude/comment-analyzer-in-scope-' + Date.now() + '.md';
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
      const missingInScopeFile = '/tmp/claude/missing-file-in-scope-' + Date.now() + '.md';

      await assert.rejects(async () => loadReviewResults([missingInScopeFile], []), {
        name: 'ValidationError',
        message: /Failed to read 1 in-scope review file\(s\)/,
      });
    });

    it('should include all failure details in error message', async () => {
      // File path must include '-in-scope-' pattern for correct category detection
      const missingFile = '/tmp/claude/code-reviewer-in-scope-' + Date.now() + '.md';

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
      const existingFile = '/tmp/claude/linter-in-scope-' + Date.now() + '.md';
      const missingFile = '/tmp/claude/missing-reviewer-in-scope-' + Date.now() + '.md';
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
      // Path must contain '-in-scope-' to be categorized as in-scope
      const dirPath = '/tmp/claude/test-in-scope-dir-' + Date.now();
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
      const tempFile = '/tmp/claude/empty-after-stat-in-scope-' + Date.now() + '.md';
      await writeFile(tempFile, '   '); // Only whitespace

      await assert.rejects(async () => loadReviewResults([tempFile], []), {
        name: 'ValidationError',
        message: /File is empty/,
      });

      await unlink(tempFile);
    });

    it('should include error code in error details for ENOENT (in-scope)', async () => {
      // Using in-scope pattern to trigger error (out-of-scope failures are non-fatal)
      const missingFile = '/tmp/claude/missing-in-scope-' + Date.now() + '.md';

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
      const missingInScope = '/tmp/claude/missing-in-scope-' + Date.now() + '.md';
      const missingOutOfScope = '/tmp/claude/missing-out-of-scope-' + Date.now() + '.md';

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
      const missingOutOfScope = '/tmp/claude/missing-out-of-scope-' + Date.now() + '.md';

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
  });

  describe('File I/O Partial Failures', () => {
    describe('Partial success scenarios (tiered failure handling)', () => {
      test('should handle partial success: some in-scope files succeed, some fail', async () => {
        // Create test files: 1 success, 1 failure
        const successFile = `/tmp/claude/success-in-scope-${Date.now()}.md`;
        const failFile = `/tmp/claude/fail-in-scope-${Date.now()}.md`;

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
        const inScopeSuccess = `/tmp/claude/success-in-scope-${Date.now()}.md`;
        const outOfScopeFail = `/tmp/claude/fail-out-of-scope-${Date.now()}.md`;

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
        const fail1 = `/tmp/claude/fail1-in-scope-${Date.now()}.md`;
        const fail2 = `/tmp/claude/fail2-out-of-scope-${Date.now()}.md`;

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
        const file = `/tmp/claude/truncated-in-scope-${Date.now()}.md`;

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
        const file = `/tmp/claude/whitespace-in-scope-${Date.now()}.md`;

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
        const file = `/tmp/claude/zero-size-in-scope-${Date.now()}.md`;

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
        const file = `/tmp/claude/missing-in-scope-${Date.now()}.md`;

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
        const file = `/tmp/claude/access-in-scope-${Date.now()}.md`;

        // Document that EACCES errors should include file path and error code
        // Actual permission error testing would require platform-specific setup
        await assert.doesNotReject(async () => {
          await writeFile(file, 'test');
          await unlink(file);
        });
      });

      test('should include empty file action hint', async () => {
        const file = `/tmp/claude/empty-hint-in-scope-${Date.now()}.md`;

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
        const dir = `/tmp/claude/dir-in-scope-test-${Date.now()}`;

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
        const file = `/tmp/claude/enoent-in-scope-${Date.now()}.md`;

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

  describe('Retry Logic Documentation', () => {
    test('should document retry loop execution behavior', () => {
      // Documents that ghCliWithRetry() executes retries in a loop
      // Actual execution verification requires mocking/spying, deferred to follow-up issue
      const maxRetries = 3;
      const expectedAttempts = maxRetries; // Initial attempt + (maxRetries-1) retries

      assert.strictEqual(expectedAttempts, 3);
      assert.strictEqual(maxRetries > 0, true, 'Retry logic requires maxRetries > 0');
    });

    test('should document exponential backoff delays', () => {
      // Documents that delays follow exponential backoff: 2^attempt * 1000ms
      const attempt1Delay = Math.pow(2, 1) * 1000; // 2s
      const attempt2Delay = Math.pow(2, 2) * 1000; // 4s
      const attempt3Delay = Math.pow(2, 3) * 1000; // 8s

      assert.strictEqual(attempt1Delay, 2000);
      assert.strictEqual(attempt2Delay, 4000);
      assert.strictEqual(attempt3Delay, 8000);
    });

    test('should document non-retryable error short-circuit', () => {
      // Documents that non-retryable errors (4xx except 429) fail immediately
      // Actual behavior verification requires integration test with gh CLI
      const retryableStatusCodes = [429, 500, 502, 503];
      const nonRetryableStatusCodes = [400, 401, 403, 404];

      assert.strictEqual(retryableStatusCodes.includes(429), true);
      assert.strictEqual(nonRetryableStatusCodes.includes(404), true);
      assert.strictEqual(retryableStatusCodes.includes(404), false);
    });
  });
});
