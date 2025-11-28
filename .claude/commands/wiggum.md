---
description: Recursively monitor CI, fix failures, and address PR review feedback until approval
model: haiku
---

You are tasked with monitoring CI/CD workflows and PR review feedback in a recursive loop until the PR is approved or iteration limit is reached. Follow these steps:

## Step 0: Validate PR Exists

- Run `gh pr view --json number,headRefName` to validate a PR exists for the current branch
- If command fails or returns no PR, return error: "No PR found for current branch"
- Extract and store the PR number for later use
- Initialize iteration counter at 0 (maximum 10 iterations allowed)

## Step 1: Monitor Workflow

- Call `mcp__gh-workflow__gh_monitor_run` with the current branch to monitor the latest workflow
- Wait for the result:
  - **On SUCCESS**: Proceed to Step 2
  - **On FAILURE**:
    1. Call `mcp__gh-workflow__gh_get_failure_details` to get a token-efficient error summary
    2. Use Task tool with `subagent_type="Plan"` and `model="opus"` to debug the failure using the error summary, identify root cause, and create a fix plan
    3. Use Task tool with `subagent_type="accept-edits"` and `model="sonnet"` to implement the fix
    4. Execute `/commit-merge-push` command
       - **If push hook reports testing errors**, recursively handle:
         a. Use Task tool with `subagent_type="Plan"` and `model="opus"` to diagnose the testing errors and plan fix
         b. Use Task tool with `subagent_type="accept-edits"` and `model="sonnet"` to implement the fix
         c. Retry `/commit-merge-push`
         d. Repeat recursively until push succeeds or manual intervention is required
    5. Increment iteration counter
    6. If iteration counter >= 10, exit with message: "Iteration limit reached. Progress made: [summary of work completed]"
    7. Return to Step 1 (restart workflow monitoring)

## Step 2: PR Review

- Use Task tool with `subagent_type="accept-edits"` and `model="sonnet"` to execute `/pr-review-toolkit:review-pr` (no arguments)
- Wait for review to complete and analyze the feedback:
  - **If NO ISSUES** (PR has zero issues identified - not even minor ones):
    1. Post a summary PR comment using: `gh pr comment <number> --body "<summary of review - all checks passed>"`
       - Ensure all `gh` commands use `dangerouslyDisableSandbox: true` per CLAUDE.md
    2. Command complete, exit successfully with message: "PR review complete with no issues identified"
  - **If ANY ISSUES exist** (including minor suggestions, style issues, or any feedback whatsoever):
    1. Post the full feedback as a PR comment using: `gh pr comment <number> --body "<feedback>"`
       - Ensure all `gh` commands use `dangerouslyDisableSandbox: true` per CLAUDE.md
    2. Use Task tool with `subagent_type="Plan"` and `model="opus"` to create a plan to address ALL issues (do not skip minor issues)
    3. Use Task tool with `subagent_type="accept-edits"` and `model="sonnet"` to implement the fixes for ALL issues
    4. Execute `/commit-merge-push` (with recursive error handling as described in Step 1)
    5. Increment iteration counter
    6. If iteration counter >= 10, exit with message: "Iteration limit reached. Progress made: [summary of work completed]"
    7. Return to Step 1 (restart workflow monitoring)

## Important Notes

- All `gh` commands MUST use `dangerouslyDisableSandbox: true` per CLAUDE.md
- Each iteration should fully complete before moving to the next
- When using Task tool, always specify the `model` parameter explicitly
- Track all work completed for the final progress summary if iteration limit is reached
- Handle edge cases gracefully (e.g., no workflows found, PR closed, etc.)
- The loop structure is: Workflow Monitoring → PR Review → (if needed) Fix → Commit → Workflow Monitoring...
