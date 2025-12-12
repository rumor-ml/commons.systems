---
description: Commit all changes, merge from main, and push to remote
model: haiku
---

1. Invoke the commit subagent. Wait for successful commit before proceeding.
2. Run `git fetch origin && git merge origin/main`.
3. **If conflicts occur**: Invoke the resolve-conflicts subagent. Wait for successful resolution before proceeding.
4. Invoke the push subagent.
5. **STOP after pushing.** Do NOT create a pull request.
