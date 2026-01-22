# Test Specification: /enhance Skill Workflow

This document specifies the test scenarios for the `/enhance` skill workflow defined in `enhance.md`.

**Note**: These are integration/behavioral tests for the workflow orchestration logic. The individual MCP tools (`gh_prioritize_issues`, `gh_check_issue_dependencies`) have their own unit tests in `gh-workflow-mcp-server/src/tools/*.test.ts`. Duplicate detection is now performed using LLM semantic analysis instead of a dedicated MCP tool.

## Positive Test Cases - Workflow Execution

### Test 1: Select Highest Priority Tier 1 Issue

**Setup:**

- Mock `gh_prioritize_issues` to return:
  - Tier 1 (Bug): Issue #100 (priority_score: 10), Issue #101 (priority_score: 5)
  - Tier 2 (Code Reviewer): Issue #200 (priority_score: 15)
  - Tier 3 (Code Simplifier): Issue #300 (priority_score: 20)
  - Tier 4 (Other): Issue #400 (priority_score: 25)

**Expected:**

- Step 3 selects Issue #100 (Tier 1 takes precedence over higher-scored Tier 2/3/4)
- Proceeds to Step 4 (duplicate detection)

**Validates:** Tier-based prioritization logic with four-tier system

---

### Test 2: Skip Issues with "in progress" Label

**Setup:**

- Mock `gh_prioritize_issues` to return:
  - Tier 1: Issue #100 (has "in progress" label)
  - Tier 2: Issue #200 (no "in progress" label)

**Expected:**

- Step 3 skips Issue #100
- Step 3 selects Issue #200 (next available)
- Proceeds to Step 4

<!-- TODO(#1491): Reference section headers instead of line numbers for maintainability -->

**Validates:** "in progress" skip logic (Step 3, lines 86-87 in enhance.md)

---

### Test 3: Skip Issues Blocked by Open Dependencies

**Setup:**

- Mock `gh_prioritize_issues` to return Tier 1: Issue #100, Issue #101
- Mock `gh_check_issue_dependencies` for Issue #100 to return: `{ status: "BLOCKED", ... }`
- Mock `gh_check_issue_dependencies` for Issue #101 to return: `{ status: "ACTIONABLE", ... }`

**Expected:**

- Step 3 skips Issue #100 (blocked)
- Step 3 selects Issue #101 (actionable)
- Logs: "Skipped #100 - blocked by open issue(s)"
- Proceeds to Step 4

**Validates:** Dependency blocking logic (Step 3, lines 88-91 in enhance.md)

---

### Test 4: Never Auto-Close Issues Marked "in progress"

**Setup:**

- Selected issue: #100
- LLM duplicate analysis identifies:
  - CONFIRMED_DUPLICATES: Issue #50 (has "in progress" label, confidence: 98%)
  - LIKELY_DUPLICATES: Issue #51 (no "in progress" label, confidence: 85%)

**Expected:**

- Step 4.2 filters out Issue #50 (has "in progress" label)
- Step 5 does NOT attempt to close Issue #50
- Step 5 may close Issue #51 (user confirmation)

**Validates:** Critical safety check to never close "in progress" issues (Step 4.2)

---

### Test 5: Handle Zero Enhancement Issues Gracefully

**Setup:**

- Mock `gh_prioritize_issues` to return empty tiers (no issues)

**Expected:**

- Step 1 returns: "No open enhancement issues found"
- Workflow exits cleanly (no error, no crash)

**Validates:** Empty state handling (Step 1, line 20)

---

### Test 6: Update Issue Body with Current State Before Worktree Creation

**Setup:**

- Selected issue: #100
- Mock Explore agent to return current state analysis

**Expected:**

- Step 6.2 calls `gh issue edit <issue> --body-file <temp-file>`
- Step 6.2 calls `gh issue comment <issue> --body "Verified issue..."`
- Step 7 is executed (worktree creation)

**Validates:** Issue update workflow (Step 6, lines 180-236)

---

### Test 7: Close Non-Relevant Issue and Select Next

**Setup:**

- Mock `gh_prioritize_issues` to return Tier 1: Issue #100, Issue #101
- Mock Explore agent for #100 to return: `{ status: "NOT RELEVANT", ... }`
- User confirms closure: "yes"

**Expected:**

- Step 6.3 closes Issue #100
- Workflow loops back to Step 3
- Step 3 selects Issue #101
- Proceeds to Step 4 for Issue #101

**Validates:** Non-relevant issue handling and loop-back logic (Step 6.3, lines 238-260)

---

## Negative Test Cases - Error Handling

### Test 8: LLM Duplicate Detection with Various Confidence Levels

**Setup:**

- Selected issue: #100 with title "Fix authentication timeout in login flow"
- Candidate issues include:
  - Issue #50: "Fix auth timeout during login" (near-identical, should be >95% confidence)
  - Issue #51: "Improve login authentication flow" (related but different, should be 70-90% confidence)
  - Issue #52: "Add new OAuth provider" (unrelated, should be <70% confidence)

**Expected:**

- Step 4.3 analyzes semantic similarity
- CONFIRMED_DUPLICATES includes Issue #50 (>95% confidence)
- LIKELY_DUPLICATES includes Issue #51 (70-95% confidence)
- Issue #52 is excluded (<70% confidence)
- Step 5 auto-closes Issue #50
- Step 5 asks user confirmation for Issue #51

**Validates:** LLM semantic analysis with confidence thresholds

---

### Test 9: GitHub API Unavailable During Step 1

**Setup:**

- Mock `gh_prioritize_issues` to throw network timeout error

**Expected:**

- Step 1 catches error
- Returns user-friendly error: "GitHub API is unavailable. Please check your network connection and authentication, then retry."
- Workflow exits gracefully (no crash)

**Validates:** Network error handling (Error Handling section)

---

### Test 10: Selected Issue Deleted Between Step 3 and Step 7

**Setup:**

- Selected issue: #100 in Step 3
- Mock `gh issue edit` in Step 6 to return 404 (issue not found)

**Expected:**

- Step 6 logs error: "Issue #100 was deleted. Moving to next issue."
- Workflow loops back to Step 3 to select next available issue
- OR: Workflow exits with clear error message

**Validates:** Mid-workflow deletion handling

---

### Test 11: All Issues are In-Progress or Blocked (Infinite Loop Risk)

**Setup:**

- Mock `gh_prioritize_issues` to return:
  - Tier 1 (Bug): Issue #100 (has "in progress" label)
  - Tier 2 (Code Reviewer): Issue #200 (blocked by dependencies)
  - Tier 3 (Code Simplifier): Issue #300 (has "in progress" label)
  - Tier 4 (Other): Issue #400 (blocked by dependencies)

**Expected:**

- Step 3 iterates through all four tiers
- Step 3 skips all issues
- Step 3 exits with: "No enhancement issues to work on (all may be in progress or blocked)"
- Workflow exits cleanly (no infinite loop)

**Validates:** Exhaustion of all tiers without infinite loop with four-tier system

---

### Test 12: Worktree Creation Fails After Duplicate Closure

**Setup:**

- Selected issue: #100
- Mock duplicate closure in Step 5: close Issue #50, #51
- Mock worktree skill in Step 7 to fail: "Error: Disk full"

**Expected:**

- Step 7 returns error message including:
  - "Worktree creation failed: Disk full"
  - "Duplicates closed: #50, #51"
  - "Manual recovery: Create worktree manually or reopen closed duplicates if needed"
- Workflow does NOT proceed to Step 8

**Validates:** Partial state corruption handling (Error Handling section)

---

### Test 13: User Cancels Duplicate Closure Confirmation

**Setup:**

- Selected issue: #100
- LLM analysis returns LIKELY_DUPLICATES: Issue #50 (confidence: 82%)
- User responds: "no" to closure confirmation in Step 5

**Expected:**

- Step 5 does NOT close Issue #50
- Workflow continues to Step 6 (verification)
- Priority issue (#100) is NOT updated with "Duplicates Closed" section

**Validates:** User cancellation handling for likely duplicates

---

### Test 14: gh CLI Authentication Expires Mid-Workflow

**Setup:**

- Selected issue: #100
- Mock `gh issue edit` in Step 6 to return: "Error: authentication required"

**Expected:**

- Step 6 catches authentication error
- Returns user-friendly error: "GitHub authentication expired. Run 'gh auth login' and retry."
- Workflow exits gracefully

**Validates:** Authentication error handling

---

### Test 15: Repository Dependencies Feature Disabled (404 from API)

**Setup:**

- Mock `gh_check_issue_dependencies` to return: 404 (feature not enabled)

**Expected:**

- Step 3 handles 404 gracefully
- Assumes issue is ACTIONABLE (no blocking dependencies)
- Logs warning: "Dependencies feature not enabled, skipping dependency check"
- Continues with issue selection

**Validates:** Missing feature handling

---

## Integration Test Scenarios (Cross-Step Validation)

### Test 16: Full Happy Path Workflow

**Setup:**

- Mock all tools to return successful responses
- No issues marked "in progress" or blocked
- No duplicates found
- Issue is relevant
- Worktree creation succeeds

**Expected:**

- All 8 steps execute in sequence
- Step 8 reports completion with summary
- No errors logged

**Validates:** End-to-end successful workflow

---

### Test 17: Complex Prioritization with Multiple Skips

**Setup:**

- Tier 1 (Bug): Issue #100 ("in progress"), Issue #101 (blocked), Issue #102 (actionable)
- Tier 2 (Code Reviewer): Issue #200 (actionable)
- Tier 3 (Code Simplifier): Issue #300 (actionable)
- Tier 4 (Other): Issue #400 (actionable)

**Expected:**

- Step 3 skips #100 (in progress)
- Step 3 skips #101 (blocked)
- Step 3 selects #102 (first actionable in Tier 1)
- Does NOT consider Tier 2/3/4 (Tier 1 has actionable issue)

**Validates:** Complex skip logic with multiple conditions across four-tier system

---

## Implementation Notes

Since the `/enhance` skill is a markdown-based workflow (not executable code), these tests would require:

1. **Test Harness**: A system to parse and execute markdown workflow steps
2. **Mock Infrastructure**: Ability to mock MCP tool responses (gh_prioritize_issues, etc.)
3. **State Tracking**: Monitor which steps are executed and in what order
4. **Assertion Framework**: Validate expected outcomes at each step

**Alternative Approach**: Manual testing checklist based on these scenarios until automated testing infrastructure is available.

**Related Issues:**

- pr-test-analyzer-in-scope-2: No test coverage for /enhance skill workflow execution
- pr-test-analyzer-in-scope-4: Missing negative test cases for invalid /enhance skill inputs
