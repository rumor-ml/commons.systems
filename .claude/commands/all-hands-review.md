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

## Step 2: Launch Parallel Review Agents

Use the Task tool to launch ALL 6 pr-review-toolkit agents in PARALLEL (make 6 Task calls in a single response):

1. **pr-review-toolkit:code-reviewer**
   - `subagent_type`: "pr-review-toolkit:code-reviewer"
   - Pass context: "Review changes from origin/main...HEAD"

2. **pr-review-toolkit:silent-failure-hunter**
   - `subagent_type`: "pr-review-toolkit:silent-failure-hunter"
   - Pass context: "Hunt for silent failures in changes from origin/main...HEAD"

3. **pr-review-toolkit:code-simplifier**
   - `subagent_type`: "pr-review-toolkit:code-simplifier"
   - Pass context: "Find simplification opportunities in changes from origin/main...HEAD"

4. **pr-review-toolkit:comment-analyzer**
   - `subagent_type`: "pr-review-toolkit:comment-analyzer"
   - Pass context: "Analyze comments in changes from origin/main...HEAD"

5. **pr-review-toolkit:pr-test-analyzer**
   - `subagent_type`: "pr-review-toolkit:pr-test-analyzer"
   - Pass context: "Analyze tests in changes from origin/main...HEAD"

6. **pr-review-toolkit:type-design-analyzer**
   - `subagent_type`: "pr-review-toolkit:type-design-analyzer"
   - Pass context: "Analyze type design in changes from origin/main...HEAD"

**CRITICAL:** Launch all 6 agents in parallel (single response with 6 Task calls). Do NOT launch them sequentially.

## Step 3: Aggregate Results

After all agents complete:

1. Collect the verbatim response from each agent
2. Parse each response to extract findings and priority levels
3. Count total issues by priority:
   - High priority issues
   - Medium priority issues
   - Low priority issues

## Step 4: Format Output

Present results in this format:

```
## All-Hands Review Complete

### Summary
- **High Priority Issues:** [count]
- **Medium Priority Issues:** [count]
- **Low Priority Issues:** [count]
- **Total Issues:** [total]

### Agent Results

#### Code Reviewer
[verbatim response from code-reviewer agent]

---

#### Silent Failure Hunter
[verbatim response from silent-failure-hunter agent]

---

#### Code Simplifier
[verbatim response from code-simplifier agent]

---

#### Comment Analyzer
[verbatim response from comment-analyzer agent]

---

#### PR Test Analyzer
[verbatim response from pr-test-analyzer agent]

---

#### Type Design Analyzer
[verbatim response from type-design-analyzer agent]

---

### Review Scope
Branch changes reviewed: `origin/main...HEAD`
```

## Important Notes

- **You are an orchestrator** - validate git state yourself, then delegate review work to specialized agents
- All agents run in parallel for maximum speed
- Each agent is smart enough to handle irrelevant changes - run all 6 every time
- Use `origin/main...HEAD` (THREE dots) to exclude already-merged commits
- Collect verbatim responses from all agents for complete audit trail
- Count issues accurately for wiggum integration
