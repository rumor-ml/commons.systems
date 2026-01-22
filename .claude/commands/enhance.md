---
description: Prioritize and work on enhancement issues
model: sonnet
---

<!-- Test specifications exist in enhance.test.md (17 comprehensive scenarios)
     covering all workflow steps and error cases. However, automated test
     execution requires infrastructure (workflow parser, MCP mocking, assertion
     framework) that is out of scope for this skill.

     Related: pr-test-analyzer-in-scope-2 (workflow execution tests)
     Status: Test specs exist; execution infrastructure is a separate project
     TODO(#1490): Clarify internal reference format or link to actual GitHub issues
-->

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

## Step 1: Fetch and Prioritize Enhancement Issues

Use the MCP tool to fetch and prioritize all open enhancement issues:

```
mcp__gh-workflow__gh_prioritize_issues({
  label: "enhancement",
  state: "open",
  limit: 1000
})
```

- If no issues found, return: "No open enhancement issues found"
- The tool returns issues categorized into four tiers with priority scores
- Tier 1: Bug (highest priority)
- Tier 2: Code Reviewer
- Tier 3: Code Simplifier
- Tier 4: Other enhancements
- Within each tier, issues are sorted by priority score (max of comment count and "found while working on" count)

## Step 2: Parse Prioritization Results

**IMPORTANT**: During selection (Step 3), we will skip:

- Issues with "in progress" label (already being worked on)
- Issues blocked by open dependencies (not ready to work on)

Parse the output from Step 1 to extract the four-tier categorization:

**Tier 1 (Highest Priority)**: Issues with `bug` label

- Critical bugs that need to be fixed
- Sorted by priority score (descending)

**Tier 2 (High Priority)**: Issues with `code-reviewer` label (but not `bug`)

- Issues identified by code review agents
- Sorted by priority score (descending)

**Tier 3 (Medium Priority)**: Issues with `code-simplifier` label (but not `bug` or `code-reviewer`)

- Code simplification opportunities
- Sorted by priority score (descending)

**Tier 4 (Standard)**: All other enhancement issues

- Standard enhancements to be evaluated
- Sorted by priority score (descending)

**Priority Score** (calculated by the MCP tool):

`priority_score = max(comment_count, found_while_working_count)`

Where:

- `comment_count` = number of comments on the issue
- `found_while_working_count` = number of issues referenced in "Found while working on" line in the issue body
  - Example: "Found while working on #1258" → count = 1
  - Example: "Found while working on #1234, #1235, #1236" → count = 3
  - No "Found while working on" line → count = 0

**Rationale**: Issues found during work on multiple other issues are likely to be blockers or important cross-cutting concerns.

## Step 3: Select Priority Issue

From the prioritized tiers (from Step 1):

1. If Tier 1 has issues: Select the first available Tier 1 issue (see selection criteria below)
2. Else if Tier 2 has issues: Select the first available Tier 2 issue (see selection criteria below)
3. Else if Tier 3 has issues: Select the first available Tier 3 issue (see selection criteria below)
4. Else if Tier 4 has issues: Select the first available Tier 4 issue (see selection criteria below)
5. Else: Return "No enhancement issues to work on (all may be in progress or blocked)"

**Selection Criteria** - Skip issues that have:

- "in progress" label (already being worked on)
- Open blocking dependencies (check using MCP tool)

**Algorithm**:

```
For each tier (Tier 1, then Tier 2, then Tier 3, then Tier 4):
  1. Issues are already sorted by priority_score from Step 1

  2. For each issue in sorted tier:
     a. Check if issue has "in progress" label → Skip if yes

     b. Check if issue has open blocking dependencies:
        - Use: mcp__gh-workflow__gh_check_issue_dependencies({ issue_number: <num> })
        - If status is "BLOCKED" → Skip this issue
        - Log: "Skipped #<num> - blocked by open issue(s)"

     c. If issue passes both checks → Select it and stop

  3. If all issues in tier are skipped → Move to next tier
```

Store the selected issue as `PRIORITY_ISSUE` (number, title, url, comments, priority_score).

**Priority Score Rationale**:

- **Comment count**: More comments indicate community interest and clearer requirements
- **"Found while working on" count**: Issues discovered during work on multiple other issues are likely blockers or important cross-cutting concerns
- Using the maximum ensures issues are prioritized either by engagement OR by being blocking issues

## Step 4: Duplicate Detection

**SAFETY CHECK**: Skip any issue with "in progress" label - never close issues being actively worked on.

Perform semantic duplicate analysis by comparing the priority issue against all other enhancement issues:

### 4.1: Fetch All Enhancement Issues

Use gh CLI to fetch all open enhancement issues with full details:

```bash
gh issue list --label enhancement --state open --json number,title,body,labels --limit 1000
```

### 4.2: Filter Candidate Issues

From the fetched issues:

1. Exclude the priority issue itself
2. Exclude issues with "in progress" label (never close issues being worked on)
3. Store remaining issues as candidates for duplicate analysis

### 4.3: Semantic Duplicate Analysis

For each candidate issue, compare its title and body against the priority issue's title and body.

**Perform semantic analysis to determine:**

- Are the issues describing the same problem or feature request?
- Do they have the same underlying goal or outcome?
- Would fixing one issue also resolve the other?

**Confidence Thresholds:**

- **>95% confidence**: CONFIRMED_DUPLICATES - Issues that are clearly the same (e.g., identical or near-identical descriptions, same specific bug/feature)
- **70-95% confidence**: LIKELY_DUPLICATES - Issues that appear similar but may have subtle differences

**Consider:**

- Title similarity (semantic meaning, not just word overlap)
- Body content overlap (described symptoms, proposed solutions, code references)
- Specific details (file paths, error messages, feature descriptions)

**Output**: Two lists:

- `CONFIRMED_DUPLICATES[]`: Issues with >95% confidence of being duplicates
- `LIKELY_DUPLICATES[]`: Issues with 70-95% confidence of being duplicates

**Format each duplicate entry as:**

```
{
  number: <issue_number>,
  title: "<issue_title>",
  confidence: <percentage>,
  reason: "<brief explanation of why it's a duplicate>"
}
```

## Step 5: Close Duplicates

### Auto-Close Confirmed Duplicates

For each issue in `CONFIRMED_DUPLICATES[]`:

```bash
gh issue close <duplicate-number> \
  --comment "Closing as duplicate of #<priority-number> (<priority-title>). These issues have identical titles."
```

### Ask User Confirmation for Likely Duplicates

If `LIKELY_DUPLICATES[]` is not empty:

1. Present the list to user:

   ```
   Found likely duplicates (≥70% title similarity):
   - #<num>: <title> (similarity: X%)
   - #<num>: <title> (similarity: X%)

   Close these as duplicates of #<priority-num>? (yes/no)
   ```

2. If user confirms "yes", close each with:
   ```bash
   gh issue close <duplicate-number> \
     --comment "Closing as likely duplicate of #<priority-number> (<priority-title>). Titles are highly similar (X% match)."
   ```

### Update Priority Issue Body

If any duplicates were closed (confirmed or user-approved), update the priority issue:

```bash
gh issue edit <priority-number> \
  --body "<original-body>

---

**Duplicates Closed**: #<num1>, #<num2>, #<num3>"
```

## Step 6: Verify Issue Relevance and Update with Current Code State

**IMPORTANT**: Before creating a worktree, ALWAYS verify the issue reflects the current codebase state and update it accordingly.

### 6.1: Investigate Current Code State

Use the Task tool with `subagent_type="Explore"` to investigate the issue against current code:

```bash
Task(
  subagent_type: "Explore",
  prompt: "Investigate issue #<priority-number>: '<priority-title>'. Analyze the current codebase and provide detailed current state information:

  1. Does the code/feature mentioned in the issue still exist?
  2. Has the bug already been fixed or feature already implemented?
  3. What are the CURRENT file paths, line numbers, function names?
  4. What are the CURRENT file sizes, pattern occurrences, or metrics mentioned?
  5. Are there any changes to the code structure since the issue was filed?

  Provide:
  - Status: RELEVANT (issue is valid) or NOT RELEVANT (obsolete/fixed)
  - Current state details: specific line numbers, file sizes, pattern counts, etc.
  - What changed: brief summary of any differences from issue description
  - Specific updates needed: list exact changes to make the issue current

  Be thorough - we will ALWAYS update the issue with this information."
)
```

### 6.2: Always Update Issue with Current Code State

**For ALL relevant issues** (whether current or outdated):

1. Draft an updated issue body that:
   - Adds or updates the update notice at the top with current date
   - Provides current metrics (file sizes, line numbers, pattern occurrences)
   - Updates any code references to match current state
   - Notes what has changed since last update (if anything)
   - Preserves the original issue description and metadata
   - Maintains any "Duplicates Closed" section at the end

2. Update the issue:

   ```bash
   gh issue edit <priority-number> --body-file <temp-file-with-updated-body>
   ```

3. Add a comment with verification details:

   ```bash
   gh issue comment <priority-number> \
     --body "Verified issue against current codebase (2026-01-22). Current state: <current metrics>. <Changes summary or 'No changes needed - issue is current'>"
   ```

4. Continue to Step 7 (create worktree)

**Rationale**: Always updating ensures issues are synchronized with the current codebase before work begins, preventing wasted effort on outdated information.

### 6.3: Handle Non-Relevant Issues

If the Explore agent determines the issue is **NOT RELEVANT**:

1. Use AskUserQuestion to confirm closure:

   ```
   Issue #<priority-number> appears to be no longer relevant to the current codebase.

   Reason: <agent's explanation>

   Close this issue and proceed to the next highest priority enhancement? (yes/no)
   ```

2. If user confirms "yes":
   - Close the issue with explanatory comment:
     ```bash
     gh issue close <priority-number> \
       --comment "Closing as no longer relevant. <Brief explanation from Explore agent>"
     ```
   - Remove the closed issue from the prioritized lists
   - **Loop back to Step 3** to select the next highest priority issue
   - Continue with duplicate detection and relevance verification for the new selection

3. If user confirms "no":
   - Still update the issue with current state (Step 6.2) before proceeding
   - Continue to Step 7 (create worktree anyway)
   - User may want to update/redefine the issue during implementation

## Step 7: Create Worktree for Priority Issue

Execute the worktree skill with the priority issue number:

```bash
# This is a skill invocation, not a bash command
Skill(skill: "worktree", args: "#<priority-number>")
```

The worktree skill will:

- Create a new worktree at `~/worktrees/<branch-name>`
- Remove "ready" label and add "in progress" label
- Open a new tmux window for work

## Step 8: Report Completion

Provide a summary:

```
✓ Enhancement workflow complete

Selected Issue: #<priority-number> - <title>
Priority Tier: <1, 2, or 3>
Reason: <why this issue was selected>

Duplicates Closed:
- Confirmed (exact match): <count> issues
- User-approved (≥70% similarity): <count> issues
- Total: <count> issues

Worktree Location: ~/worktrees/<branch-name>

Ready to begin work on enhancement #<priority-number>
```

## Error Handling

<!-- Test specifications exist in enhance.test.md (Tests 8-15) covering all
     error handling scenarios including API failures, invalid inputs, and edge
     cases. Automated test execution requires infrastructure that is out of
     scope for this skill.

     Related: pr-test-analyzer-in-scope-4 (error handling tests)
     Status: Test specs exist; execution infrastructure is a separate project
     TODO(#1490): Clarify internal reference format or link to actual GitHub issues
-->

<!-- TODO(#1454): Add explicit error handling instructions for MCP tool failures (isError responses, timeouts, auth failures) -->

- **No issues found**: Report "No open enhancement issues found" and exit
- **Network errors**: Report error and suggest user retry
- **No PR for duplicate closure**: Continue with workflow, report issue
- **Explore agent fails**: Assume issue is relevant and continue to Step 7
- **Worktree skill fails**: Report error, do not proceed to Step 8
- **All issues marked not relevant**: Report error and exit workflow

## Implementation Notes

- ALL bash commands MUST use `dangerouslyDisableSandbox: true`
- Parse JSON carefully - handle missing/null fields gracefully
- Preserve original issue bodies when appending duplicate list
- Use exact label strings: "enhancement", "bug", "high priority", "in progress"
- Calculate Jaccard similarity using word-level tokens (not character n-grams)
