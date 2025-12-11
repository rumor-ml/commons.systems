# Wiggum MCP Server

MCP server for Wiggum operations.

## Installation

```bash
pnpm install
npm run build
```

## Usage

### Local Development

```bash
npm run dev
```

### Configuration

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "wiggum": {
      "command": "node",
      "args": ["/path/to/wiggum-mcp-server/dist/index.js"]
    }
  }
}
```

## Available Tools

### wiggum_next_step

Primary orchestration tool that analyzes current state and returns next action instructions.

**Inputs:** None (auto-detects state from git, GitHub PR, and PR comments)

**Returns:**

- `current_step`: Name of current step
- `step_number`: Step identifier (0, 1, 1b, 2, 3, 4, 4b, approval)
- `iteration_count`: Current iteration count (max 10)
- `instructions`: Detailed instructions for next action
- `context`: PR number and current branch

**Workflow Steps:**

1. **Step 0 - Ensure PR Exists**: Verify branch is pushed and PR is created
2. **Step 1 - Monitor Workflow**: Monitor GitHub Actions workflow completion
3. **Step 1b - Monitor PR Checks**: Monitor all PR status checks
4. **Step 2 - Code Quality**: Review and address code quality bot comments
5. **Step 3 - PR Review**: Execute comprehensive PR review
6. **Step 4 - Security Review**: Execute security review
7. **Step 4b - Verify Reviews**: Verify both reviews were executed
8. **Approval**: Post summary and approve PR

### wiggum_complete_pr_review

Completes PR review step after executing `/pr-review-toolkit:review-pr`.

**Inputs:**

- `command_executed` (boolean): Confirm command was executed
- `verbatim_response` (string): Complete response from review command
- `high_priority_issues` (number): Count of high priority issues
- `medium_priority_issues` (number): Count of medium priority issues
- `low_priority_issues` (number): Count of low priority issues

**Behavior:**

- Posts structured PR comment with review results
- If issues found: increments iteration, returns Plan+Fix instructions
- If no issues: marks step complete, proceeds to next step

### wiggum_complete_security_review

Completes security review step after executing `/security-review`.

**Inputs:**

- `command_executed` (boolean): Confirm command was executed
- `verbatim_response` (string): Complete response from security review
- `high_priority_issues` (number): Count of high priority security issues
- `medium_priority_issues` (number): Count of medium priority security issues
- `low_priority_issues` (number): Count of low priority security issues

**Behavior:**

- Posts structured PR comment with security review results
- If issues found: increments iteration, returns Plan+Fix instructions
- If no issues: marks step complete, proceeds to next step

### wiggum_complete_fix

Completes a Plan+Fix cycle after fixing issues.

**Inputs:**

- `fix_description` (string): Brief description of what was fixed

**Behavior:**

- Posts PR comment documenting the fix
- Returns instructions to restart workflow monitoring (Step 1)
- Maximum 10 iterations allowed

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Type check
npm run typecheck
```

## Architecture

- `src/index.ts` - MCP server setup and tool registration
- `src/types.ts` - TypeScript type definitions
- `src/constants.ts` - Shared constants
- `src/utils/errors.ts` - Error handling utilities
- `src/tools/` - Individual tool implementations
