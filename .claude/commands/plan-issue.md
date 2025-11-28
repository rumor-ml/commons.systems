---
description: Break down large GitHub issues into subissues that **maximize parallelization** while keeping each subissue **<50k tokens**.
model: opus
---

You are tasked with creating an implementation plan for a GitHub issue and its related sub-issues. Follow these steps:

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

## Step 4: Present Hierarchical Context
Display the gathered information in this format:

```
# Issue Hierarchy for #<number>: <title>

## Ancestor Chain (Root → Current)
<If no ancestors: "None - this is a root issue">
<Otherwise, list from root to current:>
1. #<number>: <title>
   URL: <url>
   <Brief summary of body if relevant>

2. #<number>: <title>
   URL: <url>
   <Brief summary>

... (continue to current issue's parent)

## Current Issue: #<number>
Title: <title>
URL: <url>

Body:
<full body content>

## Direct Children (Sub-issues)
<If no children: "None - this issue has no sub-issues">
<Otherwise, list:>
- #<number>: <title>
  URL: <url>
  <Brief summary of body>

## Siblings (Other Sub-issues of Parent)
<If no parent: "None - this is a root issue">
<If parent but no other siblings: "None - this is the only sub-issue">
<Otherwise, list:>
- #<number>: <title>
  URL: <url>
  <Brief summary>
```

## Step 5: Invoke Feature Development
After presenting the hierarchical context, invoke the feature development workflow:
- Use the SlashCommand tool to execute `/feature-dev:feature-dev` with the issue title and summary
- Pass the issue context as: `/feature-dev:feature-dev Implement: <issue title> - <brief summary from issue body>`
- This hands off to the guided feature development workflow which will:
  - Explore the codebase for relevant patterns
  - Design the architecture
  - Create a detailed implementation plan

## Important Notes
- All `gh` commands use `dangerouslyDisableSandbox: true` per CLAUDE.md
- Handle cases where issue has no parent/children/siblings gracefully
- When fetching GraphQL data, parse JSON responses carefully
- If GraphQL queries fail, provide helpful error messages
- Focus on maximizing parallel work opportunities in the plan
