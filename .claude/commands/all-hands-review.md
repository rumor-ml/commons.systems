---
description: Review branch changes from origin/main with parallel agents
model: sonnet
---

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

You are an **orchestrator** for comprehensive code review. You validate git state, gather changes, and delegate review to specialized agents in parallel.

## Step 1: Validate Git State

Check that we're in a valid state for review:

1. Verify we're on a feature branch (not `main` or `master`):

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   - If on `main` or `master`, return error: "Cannot run review on main/master branch. Switch to a feature branch first."

2. Verify `origin/main` exists:

   ```bash
   git rev-parse --verify origin/main
   ```

   - If it doesn't exist, try `origin/master` as fallback
   - If neither exists, return error: "Cannot find origin/main or origin/master. Run 'git fetch origin' first."

3. Check for changes from base branch:

   ```bash
   git diff origin/main...HEAD --stat
   ```

   - If no changes, return: "No changes to review. Branch is up to date with origin/main."

## Step 1.5: Get Issue Context

Extract issue number and fetch context:

1. Get issue number from branch name:

   ```bash
   git rev-parse --abbrev-ref HEAD | grep -oE '[0-9]+' | head -1
   ```

2. Fetch issue context using gh-issue MCP (body-only mode for performance):

   ```
   mcp__gh-issue__gh_get_issue_context({ issue_number: <number>, include_comments: false })
   ```

   **Note:** Using `include_comments: false` for performance. If even the body is too large (>300K characters or truncated), fall back to just the issue body:

   ```bash
   gh issue view <number> --json number,title,body,url
   ```

3. Store the issue context (number, title, body/url) for passing to agents in next step

## Step 2: Launch Parallel Review Agents

**Active Agents:** On first iteration, all 6 agents are active. On subsequent iterations, only launch agents that are NOT in the `completedAgents` list returned by wiggum tools. Skip completed agents.

Use the Task tool to launch active agents in PARALLEL (make Task calls in a single response):

1. **code-reviewer**
   - `subagent_type`: "code-reviewer"
   - Pass context: "Review changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 1.5]"

2. **silent-failure-hunter**
   - `subagent_type`: "silent-failure-hunter"
   - Pass context: "Hunt for silent failures in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 1.5]"

3. **code-simplifier**
   - `subagent_type`: "code-simplifier"
   - Pass context: "Find simplification opportunities in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 1.5]"

4. **comment-analyzer**
   - `subagent_type`: "comment-analyzer"
   - Pass context: "Analyze comments in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 1.5]"

5. **pr-test-analyzer**
   - `subagent_type`: "pr-test-analyzer"
   - Pass context: "Analyze tests in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 1.5]"

6. **type-design-analyzer**
   - `subagent_type`: "type-design-analyzer"
   - Pass context: "Analyze type design in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 1.5]"

**CRITICAL:** Launch all 6 agents in parallel (single response with 6 Task calls). Do NOT launch them sequentially.

## Step 3: List Review Issues

After all review agents complete, call `wiggum_list_issues` to get issue references:

```
mcp__wiggum__wiggum_list_issues({ scope: 'all' })
```

This returns minimal issue references (ID, title, agent, scope, priority) without full details.

## Step 4: Create Todo List

Create todo items from the batches and out-of-scope issues returned by `wiggum_list_issues`:

### For In-Scope Batches:

Create one todo item per batch:

- **content**: `[batch-{N}] {file_count} files, {issue_count} issues` (e.g., `[batch-0] 3 files, 5 issues`)
- **activeForm**: `Fixing batch-{N} ({issue_count} issues)`
- **status**: `pending`

### For Out-of-Scope Issues:

Create one todo item per issue:

- **content**: `[out-of-scope] {issue_id}: {title}` (e.g., `[out-of-scope] code-reviewer-out-of-scope-0: Consider adding logging`)
- **activeForm**: `Tracking {title}`
- **status**: `pending`

Example todo list structure:

```
☐ [batch-0] 2 files, 3 issues
☐ [batch-1] 1 file, 2 issues
☐ [out-of-scope] code-reviewer-out-of-scope-0: Consider adding logging
☐ [out-of-scope] silent-failure-hunter-out-of-scope-0: Future improvement
```

This allows users to track progress on batches and individual out-of-scope issues.

## Step 5: Launch Implementation Agents and Fix ALL Issues

**CRITICAL: One iteration = `/all-hands-review` + fix ALL issues. Do NOT proceed to Step 6 until ALL TODO items are addressed.**

Based on the batches and issues found:

### In-Scope Batches (Launch ALL in PARALLEL)

For each in-scope batch, launch unsupervised-implement agent:

```
Task tool with subagent_type="unsupervised-implement"
Pass batch_id from wiggum_list_issues (e.g., "batch-0", "batch-1")
```

**CRITICAL:** Launch ALL in-scope implementation agents in PARALLEL (single response with multiple Task calls). They edit different files so there are no conflicts.

### Out-of-Scope Issues (Launch ALL in PARALLEL)

For each out-of-scope issue, launch out-of-scope-tracker agent:

```
Task tool with subagent_type="out-of-scope-tracker"
Pass issue ID from wiggum_list_issues
```

**CRITICAL:** Launch ALL out-of-scope-tracker agents in PARALLEL (single response with multiple Task calls).

**CRITICAL:** After ALL implementation and tracker agents complete, verify the TODO list. ALL items must show as completed before proceeding to Step 6.

## Step 6: Complete All-Hands Review

**PRECONDITION:** All in-scope issues from the TODO list must be addressed before calling this tool. If any in-scope items are still pending, go back to Step 5 and address them first.

After ALL TODO items are addressed (both out-of-scope trackers and unsupervised implementers complete), call:

```
mcp__wiggum__wiggum_complete_all_hands({})
```

This tool:

- Reads manifests internally
- Applies 2-strike agent completion logic
- Cleans up manifest files
- Returns next step instructions

## Important Notes

- **You are an orchestrator** - validate git state yourself, fetch issue context, then delegate review work to specialized agents
- **One iteration = `/all-hands-review` + fix ALL issues** - do NOT call `wiggum_complete_all_hands` until ALL TODO items are addressed
- **Active Agents** - On subsequent iterations, only launch agents NOT in `completedAgents` list
- All active agents run in parallel for maximum speed
- Agents are scope-aware and will categorize findings as in-scope or out-of-scope based on issue context
- Each agent writes findings to manifest files via `wiggum_record_review_issue`
- Use `origin/main...HEAD` (THREE dots) to exclude already-merged commits
- The completion tool reads manifests internally and handles agent completion tracking
