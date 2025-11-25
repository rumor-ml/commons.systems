---
description: Create a new PR to main for the current branch
model: haiku
---

1. Validate we're not on main branch. If on main, return error and do not proceed.
2. Push current branch to remote with `-u` flag if needed.
3. Create PR to main using `gh pr create --base main`. Auto-generate title from branch name and body from commit messages.
4. Monitor PR checks using `gh pr checks --watch`. Wait for all checks to complete.
5. Report results. If any checks failed, report which checks failed (do not attempt to fix them).
