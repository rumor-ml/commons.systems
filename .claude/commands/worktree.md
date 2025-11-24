---
description: Create a new git worktree with a branch name based on task description
model: haiku
---

1. First check if the checked out branch in the current directory is main and verify that it has no changes. If not main, or if there are changes return an error, do not proceed to step 2.
2. Generate a concise, descriptive branch name based on the task description: "{{args}}"
3. Create the worktree in ~/worktrees with this branch name - branch off main.
4. After creating the worktree, set the upstream branch to origin/<branch-name> (but don't push).
