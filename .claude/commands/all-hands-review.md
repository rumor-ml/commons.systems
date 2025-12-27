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

## Step 3: Aggregate Results

After all agents complete:

1. Parse the JSON summary from each agent's response
2. Extract from each agent:
   - `in_scope_file` path
   - `out_of_scope_file` path
   - `in_scope_count`
   - `out_of_scope_count`
3. Build arrays:
   - `inScopeFiles = [agent1.in_scope_file, agent2.in_scope_file, ...]`
   - `outOfScopeFiles = [agent1.out_of_scope_file, agent2.out_of_scope_file, ...]`
4. Sum counts:
   - `totalInScope = sum(agent.in_scope_count for all agents)`
   - `totalOutOfScope = sum(agent.out_of_scope_count for all agents)`

## Step 4: Format Output

Present results in this concise format:

```
## All-Hands Review Complete

**Results:**
- In-Scope Issues: [totalInScope]
- Out-of-Scope Recommendations: [totalOutOfScope]

**Files Generated:**
In-Scope: [inScopeFiles.length] files
Out-of-Scope: [outOfScopeFiles.length] files

**File Paths:**
In-Scope:
- [list all inScopeFiles paths]

Out-of-Scope:
- [list all outOfScopeFiles paths]

Next: These file paths will be passed to wiggum_complete_pr_review.
```

## Important Notes

- **You are an orchestrator** - validate git state yourself, fetch issue context, then delegate review work to specialized agents
- All agents run in parallel for maximum speed
- Agents are scope-aware and will categorize findings as in-scope or out-of-scope based on issue context
- Each agent writes findings to separate files and returns JSON summaries with file paths
- Use `origin/main...HEAD` (THREE dots) to exclude already-merged commits
- Aggregate file paths and counts from all agents for wiggum integration
- The file paths will be passed to wiggum_complete_pr_review for processing
