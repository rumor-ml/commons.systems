---
description: Monitor merge queue for current branch and move worktree to ~/worktrees/old on success
model: haiku
---

1. Get current branch name and worktree path:
   - Run `git rev-parse --abbrev-ref HEAD` to get branch name
   - Run `git rev-parse --show-toplevel` to get worktree path

2. Get PR number for current branch:
   - Run `gh pr view --json number -q '.number'` to get the PR number
   - If no PR found, return error: "No PR found for current branch"

3. Wait for PR checks to complete:
   - Use `mcp__gh-workflow__gh_monitor_pr_checks` with the PR number
   - Wait for all status checks to complete (default timeout: 10 minutes)
   - If checks fail, report the error and do NOT proceed to merge queue monitoring

4. Monitor merge queue:
   - Use `mcp__gh-workflow__gh_monitor_merge_queue` with the PR number
   - Wait for merge completion (default timeout: 30 minutes)

5. On successful merge:
   - Move worktree directory to `~/worktrees/old/<branch-name>`
   - Report success: "Worktree moved to ~/worktrees/old/<branch-name>"

6. On failure or timeout:
   - Report the error status
   - Do NOT move the worktree
