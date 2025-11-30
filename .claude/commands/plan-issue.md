---
description: Plan implementation for a GitHub issue by gathering context and delegating to planning agents.
model: haiku
---

You are an **orchestrator** for planning GitHub issues. You gather issue context, enter planning mode, and delegate planning to the Plan agent.

## Step 1: Validate Input
- Check if "{{args}}" is provided
- If empty, return error: "Please provide an issue number (e.g., /plan-issue 123)"
- Extract the issue number from the argument (handle both `123` and `#123` formats)

## Step 2: Fetch Issue Details
- Use `gh issue view <number> --json id,number,title,body,url -q .` to get the issue details
- Store the issue's node ID for GraphQL queries

## Step 3: Gather Hierarchical Context

### 3a. Traverse Ancestor Chain (Recursively)
- Starting with the current issue's node ID, recursively fetch parent issues until reaching the root (where parent is null)
- For each parent, use this GraphQL query:
```graphql
query($issueId: ID!) {
  node(id: $issueId) {
    ... on Issue {
      parent {
        id
        number
        title
        url
        body
      }
    }
  }
}
```
- Execute with: `gh api graphql -H "GraphQL-Features: sub_issues" -f query='...' -f issueId='<node_id>'`
- Build the full ancestor chain from root to current issue

### 3b. Fetch Direct Children (Sub-issues)
- Query the current issue's sub-issues:
```graphql
query($issueId: ID!) {
  node(id: $issueId) {
    ... on Issue {
      subIssues(first: 100) {
        nodes {
          id
          number
          title
          url
          body
        }
      }
    }
  }
}
```
- Execute with: `gh api graphql -H "GraphQL-Features: sub_issues" -f query='...' -f issueId='<node_id>'`

### 3c. Fetch Siblings (If Issue Has a Parent)
- If the issue has a parent, query the parent's sub-issues to find siblings
- Use the same sub-issues query as 3b, but with the parent's node ID
- Exclude the current issue from the siblings list

## Step 4: Enter Planning Mode
Use the `EnterPlanMode` tool to transition into planning mode.

## Step 5: Delegate Planning to Plan Agent
Use the Task tool to launch the Plan agent:
- `subagent_type`: "Plan"

Pass the full context to the Plan agent:
- Issue hierarchy (ancestors, siblings, children from Step 3)
- The issue title, body, and URL

The Plan agent will handle codebase exploration and create a comprehensive implementation plan.

## Step 6: Delegate Implementation to accept-edits Agent
Once the user approves the plan, use the Task tool to delegate implementation:
- `subagent_type`: "accept-edits"

For each implementation step, spawn an accept-edits agent with clear instructions.

## Important Notes
- **You are an orchestrator** - gather context yourself, but delegate planning to the Plan agent
- All `gh` commands require `dangerouslyDisableSandbox: true`
- Always wait for user approval before starting implementation
- Handle cases where issue has no parent/children/siblings gracefully
- When fetching GraphQL data, parse JSON responses carefully
