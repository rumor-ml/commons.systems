---
description: Commit all changes and push to remote
model: haiku
---

1. Review all changes and decide if we should create 1 commit, or if the changes are unrelated create multiple.
2. Create and execute each commit using `git add && git commit` in a single command.
3. Invoke the merge subagent with input `origin/main`. Wait for successful merge before proceeding.
4. Push to remote.
5. Monitor the triggered CICD workflows: first get the run ID with `gh run list --branch <branch> --limit 1`, then use `gh run watch <run-id>` (not sleep/poll). Wait for it to complete and report on results.
