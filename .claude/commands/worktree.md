---
description: Create a new git worktree with a branch name based on task description
model: haiku
---

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

1. Check that current branch is main with no changes. If not, return error and do not proceed.
2. Fetch and pull latest changes from origin/main.
3. Determine source for branch name from argument: "{{args}}"
   - If argument is empty: Run `gh issue list --label "ready" --limit 1 --json number,title`.
     - If no issues found, return error: "No argument provided and no issues found with 'ready' label"
     - If issue found, use it as the GitHub issue (same as #<number> case below)
   - If argument starts with `#` (e.g., `#66`): This is a gh issue number. Source is issue body.
   - Otherwise: source is argument
     3.5 If working from a GitHub issue: Update issue labels
   - Remove "ready" label: `gh issue edit <number> --remove-label "ready"`
   - Add "in progress" label: `gh issue edit <number> --add-label "in progress"`
4. Generate concise, descriptive branch name from the source.
   - If argument was a GitHub issue number: prefix the branch name with the issue number (e.g., `#23` → `23-fix-some-issue`)
5. Create worktree at `$HOME/worktrees/<branch-name>` using absolute path (NOT relative to cwd):
   `git worktree add $HOME/worktrees/<branch-name> -b <branch-name> origin/main`
6. Set upstream to origin/<branch-name> (don't push).
7. Configure git hooks path in the new worktree (required for pre-commit/pre-push hooks to work):

   ```bash
   cd $HOME/worktrees/<branch-name> && \
   MAIN_REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$HOME/commons.systems") && \
   git config core.hooksPath "$MAIN_REPO_ROOT/.git/hooks"
   ```

   NOTE: By default, Git looks for hooks in each worktree's specific hooks directory
   (.git/worktrees/<name>/hooks). To ensure all worktrees use the same hooks as the
   main repository, we must explicitly configure core.hooksPath to point to the main
   repository's hooks directory. This ensures pre-commit hooks (formatting, linting) and
   pre-push hooks (tests) execute consistently across all worktrees. The command dynamically
   resolves the main repository root using `git rev-parse` to avoid hardcoded paths. If
   rev-parse fails (shouldn't happen in a worktree), it falls back to $HOME/commons.systems
   for safety.

8. Run `direnv allow` in the new worktree directory to enable the environment.
9. Open a new tmux window running claude in nix dev shell (use absolute path from step 5):
   `tmux new-window -n "<branch-name>" -c "$HOME/worktrees/<branch-name>" "bash -c 'nix develop -c claude || exec bash'"`

   IMPORTANT: The -c path MUST match the worktree path from step 5. If it doesn't exist, tmux defaults to home directory.
