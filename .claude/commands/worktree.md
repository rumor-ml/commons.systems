---
description: Create a new git worktree with a branch name based on task description
model: haiku
---

1. Check that current branch is main with no changes. If not, return error and do not proceed.
2. Fetch and pull latest changes from origin/main.
3. Determine source for branch name from argument: "{{args}}"
   - If argument starts with `#` (e.g., `#66`): This is a gh issue number. Source is issue body.
   - Otherwise: source is argument
4. Generate concise, descriptive branch name from the source.
   - If argument was a GitHub issue number: prefix the branch name with the issue number (e.g., `#23` → `23-fix-some-issue`)
5. Create worktree in ~/worktrees with this branch name, branching off main.
6. Set upstream to origin/<branch-name> (don't push).
7. Run `direnv allow` in the new worktree directory to enable the environment.
8. Open a new tmux window running claude: `tmux new-window -n "<branch-name>" -c "<worktree-path>" claude`
