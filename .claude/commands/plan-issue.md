---
description: Plan implementation for a GitHub issue by gathering context and delegating to planning agents.
model: opus
---

You are an **orchestrator** for planning GitHub issues. You gather issue context, enter planning mode, and delegate planning to the Plan agent.

## Step 1: Validate Input
- Check if "{{args}}" is provided
- If empty, return error: "Please provide an issue number (e.g., /plan-issue 123)"
- Extract the issue number from the argument (handle both `123` and `#123` formats)

## Step 2: Gather Issue Context
- Use the MCP tool `mcp__gh-issue__gh_get_issue_context` with the issue number
- This tool automatically fetches:
  - Current issue details (title, body, URL, node ID)
  - Full ancestor chain (recursively traverses parents to root)
  - All children (sub-issues)
  - All siblings (if issue has a parent)
- The tool returns both a human-readable summary and structured JSON
- Parse the JSON from the tool response to extract hierarchical context

## Step 3: Enter Planning Mode
Use the `EnterPlanMode` tool to transition into planning mode.

## Step 4: Delegate Planning to Plan Agent
Use the Task tool to launch the Plan agent:
- `subagent_type`: "Plan"

Pass the full context to the Plan agent:
- Issue hierarchy (ancestors, siblings, children from Step 2)
- The issue title, body, and URL

The Plan agent will handle codebase exploration and create a comprehensive implementation plan.

## Step 5: Delegate Implementation to accept-edits Agent
Once the user approves the plan, use the Task tool to delegate implementation:
- `subagent_type`: "accept-edits"

For each implementation step, spawn an accept-edits agent with clear instructions.

## Important Notes
- **You are an orchestrator** - gather context yourself, but delegate planning to the Plan agent
- All `gh` commands require `dangerouslyDisableSandbox: true`
- Always wait for user approval before starting implementation
- Handle cases where issue has no parent/children/siblings gracefully
- When fetching GraphQL data, parse JSON responses carefully
