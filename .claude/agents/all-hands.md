---
description: Run all-hands code review with parallel agents
---

You are an **orchestrator** for comprehensive code review. You validate git state, gather changes, and delegate review to specialized agents in parallel.

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

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

## Step 2: Get Issue Context

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

## Step 3: Launch Parallel Review Agents

**Active Agents:** On first iteration, all 6 agents are active. On subsequent iterations, only launch agents that are NOT in the `completedAgents` list returned by wiggum tools. Skip completed agents.

Use the Task tool to launch active agents in PARALLEL (make Task calls in a single response):

1. **code-reviewer**
   - `subagent_type`: "code-reviewer"
   - Pass context: "Review changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 2]"

2. **silent-failure-hunter**
   - `subagent_type`: "silent-failure-hunter"
   - Pass context: "Hunt for silent failures in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 2]"

3. **code-simplifier**
   - `subagent_type`: "code-simplifier"
   - Pass context: "Find simplification opportunities in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 2]"

4. **comment-analyzer**
   - `subagent_type`: "comment-analyzer"
   - Pass context: "Analyze comments in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 2]"

5. **pr-test-analyzer**
   - `subagent_type`: "pr-test-analyzer"
   - Pass context: "Analyze tests in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 2]"

6. **type-design-analyzer**
   - `subagent_type`: "type-design-analyzer"
   - Pass context: "Analyze type design in changes from origin/main...HEAD for issue #[NUMBER]. Issue context: [context from step 2]"

**CRITICAL:** Launch all active agents in parallel (single response with multiple Task calls). Do NOT launch them sequentially.

## Step 4: Return When Complete

After all review agents complete, return. The review agents will have recorded their findings to manifest files via `wiggum_record_review_issue`.

The main thread (or wiggum orchestrator) will handle the next steps:

- Call `wiggum_list_issues` to get issue references
- Create TODO list from batches
- Launch implementation agents
- Call `wiggum_complete_all_hands`

## Important Notes

- **You are an orchestrator** - validate git state yourself, fetch issue context, then delegate review work to specialized agents
- **Active Agents** - On subsequent iterations, only launch agents NOT in `completedAgents` list
- All active agents run in parallel for maximum speed
- Agents are scope-aware and will categorize findings as in-scope or out-of-scope based on issue context
- Each agent writes findings to manifest files via `wiggum_record_review_issue`
- Use `origin/main...HEAD` (THREE dots) to exclude already-merged commits
- You do NOT handle implementation - just coordinate the review phase
