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

Use the Task tool to launch ALL 6 all-hands agents in PARALLEL (make 6 Task calls in a single response):

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

Create **one todo item per issue** from the issue references returned by `wiggum_list_issues`:

For each issue in the response, create a todo item:

- **content**: `[{scope}] {issue_id}: {title}` (e.g., `[in-scope] code-reviewer-in-scope-0: Missing error handling`)
- **activeForm**: `Fixing {title}` for in-scope, `Tracking {title}` for out-of-scope
- **status**: `pending`

Example todo list structure:

```
☐ [out-of-scope] code-reviewer-out-of-scope-0: Consider adding logging
☐ [out-of-scope] silent-failure-hunter-out-of-scope-0: Future improvement
☐ [in-scope] code-simplifier-in-scope-0: Duplicate function
☐ [in-scope] comment-analyzer-in-scope-0: Stale comment
```

This allows users to track progress on each individual issue.

## Step 5: Launch Implementation Agents

Based on the issues found:

### Out-of-Scope Issues (Launch in PARALLEL)

For each out-of-scope issue, launch out-of-scope-tracker agent:

```
Task tool with subagent_type="out-of-scope-tracker"
Pass issue ID from wiggum_list_issues
```

**CRITICAL:** Launch ALL out-of-scope-tracker agents in PARALLEL (single response with multiple Task calls).

### In-Scope Issues (Launch ONE AT A TIME)

For each in-scope issue, launch unsupervised-implement agent:

```
Task tool with subagent_type="unsupervised-implement"
Pass issue ID from wiggum_list_issues
```

**CRITICAL:** Launch unsupervised-implement agents SEQUENTIALLY (one at a time). Wait for each to complete before launching the next.

## Step 6: Complete All-Hands Review

After ALL subagents complete (both out-of-scope trackers and unsupervised implementers), call:

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
- All agents run in parallel for maximum speed
- Agents are scope-aware and will categorize findings as in-scope or out-of-scope based on issue context
- Each agent writes findings to separate files and returns JSON summaries with file paths
- Use `origin/main...HEAD` (THREE dots) to exclude already-merged commits
- Aggregate file paths and counts from all agents for wiggum integration
- The file paths will be passed to wiggum_complete_pr_review for processing
