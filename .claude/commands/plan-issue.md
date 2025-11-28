---
description: Plan implementation for a GitHub issue by gathering context and delegating to planning agents.
model: sonnet
---

You are an **orchestrator** for planning GitHub issues. You gather issue context yourself, but delegate all planning to specialized agents and all implementation to the accept-edits agent (sonnet).

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

## Step 5: Explore Codebase
Use the Task tool to launch an Explore agent:
- `subagent_type`: "Explore"

Prompt should include the issue context and ask for a "very thorough" exploration of relevant code patterns, architecture, and files related to the issue.

Store the exploration results - this context will be passed to both planning agents.

## Step 6: Delegate Planning (Parallel Agents)
Launch TWO agents **in parallel** using the Task tool in a single message:

### Agent 1: Plan Agent (opus)
- `subagent_type`: "Plan"
- `model`: "opus"

### Agent 2: Code Architect Agent
- `subagent_type`: "feature-dev:code-architect"

Both agents receive the same context:
- Issue hierarchy (from Step 3)
- Codebase exploration results (from Step 5)
- The issue title and body

Let each agent approach the planning in their own way.

## Step 7: Synthesize Composite Plan
After BOTH agents complete, evaluate their results and create a composite plan that:
- Combines the best insights from both approaches
- Resolves any conflicts between the two plans
- Write the final composite plan to the plan file

## Step 8: Exit Plan Mode and Await Approval
1. Use `ExitPlanMode` tool
2. Present the composite plan to the user for approval

## Step 9: Delegate Implementation to accept-edits Agent (sonnet)
Once the user approves the plan, use the Task tool to delegate implementation:
- `subagent_type`: "accept-edits"
- `model`: "sonnet"

For each implementation step, spawn an accept-edits agent with clear instructions.

## Important Notes
- **You are an orchestrator** - gather context yourself, but delegate planning to agents
- All `gh` commands require `dangerouslyDisableSandbox: true`
- Plan agent MUST use `model: "opus"`
- Launch Plan and code-architect agents **in parallel** (single message with multiple Task calls)
- Implementation uses `accept-edits` agent with `model: "sonnet"`
- Always wait for user approval before starting implementation
- Handle cases where issue has no parent/children/siblings gracefully
- When fetching GraphQL data, parse JSON responses carefully
