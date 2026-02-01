---
skill: cleanup
description: Monitor merge queue for current branch and move worktree to ~/worktrees/old on success
model: haiku
dangerouslyDisableSandbox: true
---

# /cleanup - Monitor Merge Queue and Clean Up Worktree

Monitor the merge queue for the current branch and clean up the worktree upon successful merge.

## Instructions

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

1. Get current branch name and worktree path:
   - Run `git rev-parse --abbrev-ref HEAD` to get branch name
   - Run `git rev-parse --show-toplevel` to get worktree path
   - Store these values for use in later steps

2. Get PR number for current branch:
   - Run `gh pr view --json number -q '.number'` to get the PR number
   - If no PR found, display error: "No PR found for current branch" and exit
   - Store PR number for use in later steps

3. Wait for PR checks to complete:
   - Use `mcp__gh-workflow__gh_monitor_pr_checks` with the PR number
   - Wait for all status checks to complete (default timeout: 10 minutes)
   - If checks fail:
     - Report the error details
     - Do NOT proceed to merge queue monitoring
     - Exit with status

4. Monitor merge queue:
   - Use `mcp__gh-workflow__gh_monitor_merge_queue` with the PR number
   - Wait for merge completion (default timeout: 30 minutes)

5. On successful merge, clean up worktree resources in this order:
   - First, stop emulators: Run `infrastructure/scripts/stop-emulators.sh`
     - Use `dangerouslyDisableSandbox: true`
     - This unregisters the worktree and releases pool instance if applicable
     - Check exit code: 0 = success, proceed to next step
     - Non-zero exit code: Report error and do NOT proceed to worktree move
     - Note: Script may show warnings (e.g., backend still used by other worktrees) but still exit 0
   - Then, move worktree directory to `~/worktrees/old/<branch-name>`
     - Create target directory if needed
     - Use `mv` to move the worktree
   - Report success: "Worktree moved to ~/worktrees/old/<branch-name>"

6. On failure or timeout:
   - Report the error status
   - Do NOT move the worktree
   - Suggest running `/stop-emulators` manually if needed to clean up resources
