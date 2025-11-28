---
description: Recursively monitor CI, fix failures, address github-code-quality comments, and handle PR review feedback until approval
model: haiku
---

You are tasked with monitoring CI/CD workflows, addressing automated code quality feedback, and handling PR review feedback in a recursive loop until the PR is approved or iteration limit is reached. Follow these steps:

## Step 0: Ensure PR Exists

- Run `gh pr view --json number,headRefName` to check if a PR exists for the current branch
- If command fails or returns no PR:
  1. Use Task tool with `subagent_type="PR"` to create a new PR for the current branch
  2. Extract and store the PR number from the created PR
- If PR already exists, extract and store the PR number for later use
- Initialize iteration counter at 0 (maximum 10 iterations allowed)

## Step 1: Monitor Workflow

- Use Task tool with `subagent_type="Monitor"` to monitor the latest workflow for the current branch
- Wait for the monitoring task to complete and analyze the result:
  - **On SUCCESS**: Proceed to Step 2
  - **On FAILURE**:
    1. Use Task tool with `subagent_type="Plan"` and `model="opus"` to debug the failure, identify root cause, and create a fix plan
    2. Use Task tool with `subagent_type="accept-edits"` and `model="sonnet"` to implement the fix
    3. Execute `/commit-merge-push` command
       - **If push hook reports testing errors**, recursively handle:
         a. Use Task tool with `subagent_type="Plan"` and `model="opus"` to diagnose the testing errors and plan fix
         b. Use Task tool with `subagent_type="accept-edits"` and `model="sonnet"` to implement the fix
         c. Retry `/commit-merge-push`
         d. Repeat recursively until push succeeds or manual intervention is required
    4. Increment iteration counter
    5. If iteration counter >= 10, exit with message: "Iteration limit reached. Progress made: [summary of work completed]"
    6. Return to Step 1 (restart workflow monitoring)

## Step 2: Address GitHub Code Quality Comments

- Fetch review comments from the `github-code-quality` bot using:
  ```
  gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --jq '.[] | select(.user.login == "github-code-quality[bot]")'
  ```
- If NO comments from `github-code-quality[bot]` exist, proceed directly to Step 3

- If comments exist:
  1. **IMPORTANT**: These comments are automated and NOT authoritative. Evaluate each recommendation critically to determine if it is sound.
  2. Use Task tool with `subagent_type="Plan"` and `model="opus"` to:
     - Review all github-code-quality bot comments
     - For each comment, assess whether the recommendation is valid and beneficial
     - Create a remediation plan ONLY for recommendations that are sound (skip recommendations that are incorrect, overly pedantic, or would harm code quality)
  3. If the plan identifies any valid issues to fix:
     a. Use Task tool with `subagent_type="accept-edits"` and `model="sonnet"` to implement the fixes
     b. Execute `/commit-merge-push` command (with recursive error handling as described in Step 1)
     c. Increment iteration counter
     d. If iteration counter >= 10, exit with message: "Iteration limit reached. Progress made: [summary of work completed]"
     e. Return to Step 1 (restart workflow monitoring to verify fixes)
  4. If the plan determines all comments are invalid/should be ignored, proceed to Step 3

## Step 3: PR Review

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
- The loop structure is: Workflow Monitoring → GitHub Code Quality Review → PR Review → (if needed) Fix → Commit → Workflow Monitoring...
