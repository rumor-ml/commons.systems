---
description: Create a new git worktree with a branch name based on task description
model: haiku
---

**This command now uses the gh_create_worktree MCP tool for atomic worktree creation.**

Call the `gh_create_worktree` MCP tool based on the argument: "{{args}}"

- If argument is empty: Ask the user to provide either an issue number (e.g., `#1500`) or a task description
- If argument starts with `#` followed by a number (e.g., `#66`): Extract the number and call with `{ "issue_number": 66 }`
- Otherwise: Call with `{ "description": "{{args}}" }`

The tool performs all validation, creation, and setup atomically with a single permission request.

Note: The tool requires dangerouslyDisableSandbox: true for git/gh/direnv/tmux operations, which will be automatically handled by the MCP framework.
