---
description: Commit all changes, merge from main, and push to remote
model: sonnet
---

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

**CRITICAL: All git commands MUST run with `dangerouslyDisableSandbox: true` to ensure pre-commit and pre-push hooks execute properly.**

1. Invoke the commit subagent. Wait for successful commit before proceeding.
2. Run `git fetch origin && git merge origin/main` with `dangerouslyDisableSandbox: true`.
3. **If conflicts occur**: Invoke the resolve-conflicts subagent. Wait for successful resolution before proceeding.
4. **Push to remote with hook failure handling:**

   a. Attempt push: Run `git push` with `dangerouslyDisableSandbox: true`

   b. **If push succeeds**: Proceed to step 5.

   c. **If pre-push hooks fail**: Analyze the failure and handle accordingly:

   **For Prettier Formatting Violations** (`prettier-check-all` hook):
   - Auto-fix: Run `npx prettier --write '**/*.{ts,tsx,js,jsx,json,md,yaml,yml,html,css}'` with `dangerouslyDisableSandbox: true`
   - Stage changes: `git add -A` with `dangerouslyDisableSandbox: true`
   - Verify no secrets staged: Check `git diff --cached` for .env, credentials, etc.
   - Check commit authorship: `git log -1 --format='%an %ae'`
   - Check not pushed: `git branch -vv` should show "ahead"
   - If both checks pass: `git commit --amend --no-edit` with `dangerouslyDisableSandbox: true`
   - Otherwise: Create NEW commit with message "Fix prettier formatting violations"
   - Retry push: `git push` with `dangerouslyDisableSandbox: true`

   **For Test/Build Failures** (`pre-push-tests`, `mcp-npm-test`, `mcp-nix-build`, etc.):
   - Display full error output to user
   - Explain the failure clearly
   - Do NOT attempt auto-fix
   - STOP and require manual fix

   **For Other Hook Failures**:
   - Display hook output in full
   - Provide guidance based on hook name and error
   - STOP and require manual fix

   **CRITICAL RULES:**
   - **NEVER** use `git push --no-verify` (bypasses critical checks)
   - **NEVER** amend commits that have been pushed to remote
   - **NEVER** amend other developers' commits
   - **ALWAYS** check commit authorship before amending
   - **AUTO-FIX ONLY** prettier violations (deterministic and safe)
   - **MANUAL FIX REQUIRED** for tests, builds, and business logic

5. **STOP after pushing.** Do NOT create a pull request.
