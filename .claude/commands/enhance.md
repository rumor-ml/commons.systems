---
description: Prioritize and work on enhancement issues
model: haiku
---

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

## Step 1: Fetch Enhancement Issues

Fetch all open enhancement issues from the repository:

```bash
gh issue list \
  --label "enhancement" \
  --state "open" \
  --json number,title,labels,url \
  --limit 1000
```

- If no issues found, return: "No open enhancement issues found"
- Parse the JSON output for use in subsequent steps

## Step 2: Three-Tier Prioritization

**IMPORTANT**: During selection (Step 3), we will skip:

- Issues with "in progress" label (already being worked on)
- Issues blocked by open dependencies (not ready to work on)

Analyze fetched issues and categorize into three tiers (categorization includes all issues, filtering happens in Step 3):

**Tier 1 (Highest Priority)**: Issues with BOTH `enhancement` AND `bug` labels

- These are enhancements that fix bugs - critical for stability

**Tier 2 (High Priority)**: Issues with BOTH `enhancement` AND `high priority` labels

- Important enhancements marked for priority work

**Tier 3 (Remaining)**: All other enhancement issues

- Standard enhancements to be evaluated

## Step 3: Select Priority Issue

From the prioritized tiers (all excluding "in progress" issues):

1. If Tier 1 has issues: Select the first available Tier 1 issue (see selection criteria below)
2. Else if Tier 2 has issues: Select the first available Tier 2 issue (see selection criteria below)
3. Else if Tier 3 has issues: Select the first available Tier 3 issue (see selection criteria below)
4. Else: Return "No enhancement issues to work on (all may be in progress or blocked)"

**Selection Criteria** - Skip issues that have:

- "in progress" label (already being worked on)
- Open blocking dependencies (check with `gh api repos/{owner}/{repo}/issues/{number}/dependencies/blocked_by`)

**Algorithm**:

```
For each issue in tier (highest to lowest priority):
  1. Check if issue has "in progress" label → Skip if yes
  2. Check if issue has open blocking dependencies:
     - Run: gh api repos/rumor-ml/commons.systems/issues/{number}/dependencies/blocked_by
     - If response contains any issues with state="open" → Skip this issue
  3. If issue passes both checks → Select it
  4. If all issues in tier are skipped → Move to next tier
```

Store the selected issue as `PRIORITY_ISSUE` (number, title, url).

**Note**: If an issue is skipped due to blockers, consider logging: "Skipped #<num> - blocked by open issue(s)"

## Step 4: Duplicate Detection

**SAFETY CHECK**: Skip any issue with "in progress" label - never close issues being actively worked on.

For each remaining enhancement issue (excluding the priority issue):

### Layer 1: Exact Title Match (Auto-Close)

Normalize titles for comparison:

- Convert to lowercase
- Remove all punctuation (except spaces and hyphens)
- Trim whitespace

If normalized titles match exactly:

- Mark as **confirmed duplicate** for auto-closure
- Skip Layer 2 check

### Layer 2: High Title Similarity (User Confirmation)

Calculate Jaccard similarity on word tokens:

1. Tokenize titles into words (lowercase, alphanumeric only)
2. Calculate: `similarity = (words in common) / (total unique words in both titles)`
3. If similarity ≥ 0.70 (70%): Mark as **likely duplicate** for user confirmation

**Output**: Two lists:

- `CONFIRMED_DUPLICATES[]`: Issues with exact title match
- `LIKELY_DUPLICATES[]`: Issues with ≥70% similarity

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

## Step 6: Verify Issue Relevance

**IMPORTANT**: Before creating a worktree, verify the selected issue is still relevant to the current codebase.

### 6.1: Investigate Issue Relevance

Use the Task tool with `subagent_type="Explore"` to investigate whether the issue is still relevant:

```bash
Task(
  subagent_type: "Explore",
  prompt: "Investigate issue #<priority-number>: '<priority-title>'. Analyze the current codebase to determine if this issue is still relevant. Check:

  1. Does the code/feature mentioned in the issue still exist?
  2. Has the bug already been fixed or feature already implemented?
  3. Is the issue obsolete due to refactoring or architectural changes?
  4. Are the file paths and code references in the issue still valid?
  5. If the code has changed but the issue is still valid, what specific details need updating (line numbers, function names, file paths, code snippets)?

  Provide a clear answer:
  - YES (issue is current and accurate)
  - YES BUT NEEDS UPDATE (issue is valid but details are outdated)
  - NO (issue is no longer relevant)

  Include 2-3 sentences explaining your reasoning. If updates are needed, specify exactly what should be changed."
)
```

### 6.2: Update Issue If Needed

If the Explore agent determines the issue is **still relevant BUT needs updating**:

1. Draft an updated issue body that:
   - Adds a prominent update notice at the top (with date)
   - Explains what has changed in the code since the issue was filed
   - Updates file paths, line numbers, function names, and code snippets
   - Preserves the original issue description and metadata
   - Maintains any "Duplicates Closed" section at the end

2. Update the issue:

   ```bash
   gh issue edit <priority-number> --body-file <temp-file-with-updated-body>
   ```

3. Add a comment explaining the update:

   ```bash
   gh issue comment <priority-number> \
     --body "Updated issue with current code references. Core issue remains valid. Changes: <brief summary>"
   ```

4. Continue to Step 7 (create worktree)

### 6.3: Handle Non-Relevant Issues

If the Explore agent determines the issue is **NOT relevant**:

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
   - Continue to Step 7 (create worktree anyway)
   - User may want to update/redefine the issue

### 6.4: Proceed If Issue Is Current

If the Explore agent determines the issue **IS relevant and current** (no updates needed):

- Continue to Step 7 (create worktree)

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
