---
description: Commit all changes, merge from main, and push to remote
model: sonnet
---

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

1. Invoke the commit subagent. Wait for successful commit before proceeding.
2. Run `git fetch origin && git merge origin/main`.
3. **If conflicts occur**: Invoke the resolve-conflicts subagent. Wait for successful resolution before proceeding.
4. Invoke the push subagent.

