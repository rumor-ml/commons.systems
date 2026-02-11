# Issue Tracking Rules

## Definitions

- **In scope**: Change is required to validate implementation of the GitHub issue that is currently being worked on according to the requirements in the issue body. Otherwise: "out of scope"
- **High priority**: Change will have an impact on the maintainability of the overall architecture. Otherwise: "low priority"

## Requirements Management

- Issue body is the source of truth for requirements. If new requirements are provided by the user, the issue body must be updated.
- Issue body always contains structured JSON with a list of other "source" issue numbers where this issue was identified:
  ```json
  {
    "source_issues": [1234, 5678]
  }
  ```

## Out-of-Scope Change Handling

If a change is postponed because it is determined to be **out of scope** and/or **low priority**, then two things must happen:

### 1. Create or Update GitHub Issue

A GitHub issue must always be created with:

- Label: `enhancement`
- Label: `low priority` OR `high priority` (based on priority assessment)
- Label: `bug` (if applicable)

**Before creating a new issue:**

- Use `gh issue search` to check if a similar issue already exists
- If the issue already exists:
  - Update the issue body to add the current issue number to the `source_issues` list
- If the issue does not yet exist:
  - Create it with the `source_issues` list containing the current issue number
  - Include a "Found While Working On" section referencing the source issue

### 2. Add TODO Comment to Code

Always add a TODO comment to the relevant area of code with a reference to the tracking issue number.

**TODO Comment Syntax:**

```
TODO(#ISSUE_NUMBER): Brief description of what needs to be done
```

**Examples:**

```go
// TODO(#1150): Log cleanup errors for visibility without causing false test failures
```

```bash
# TODO(#427): Add explicit error checking for lock file read failure
```

```go
t.Skip("TODO(#482): Reconnect test requires 30s timeout (tree broadcast interval) - too slow for CI")
```

## Test Skipping

If an out-of-scope flaky test is failing, or if a test is determined to be low priority and impossible to implement with the current infrastructure, then it can be skipped to get the CI to pass.

**Requirements:**

- Always add a comment to the skip with a reference to the tracking issue
- The comment should explain why the test is being skipped
- Follow the TODO comment syntax above

**Example:**

```bash
# TODO(#1852): Enable Home Manager session vars tests in CI environment
# Skip if Home Manager is not installed (e.g., CI environment)
if [ ! -f "$SESSION_VARS_FILE" ]; then
  echo -e "${YELLOW}⚠ SKIP: Home Manager not installed - session vars file not found${NC}"
  return 0
fi
```
