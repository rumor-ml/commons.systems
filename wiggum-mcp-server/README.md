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

### wiggum_init

Initialization/entry point tool that analyzes current state and returns next action instructions.

**Inputs:** None (auto-detects state from git, GitHub PR, and PR comments)

**Returns:**

- `current_step`: Name of current step
- `step_number`: Step identifier (0, 1, 1b, 2, 3, 4, 4b, approval)
- `iteration_count`: Current iteration count (max 10)
- `instructions`: Detailed instructions for next action
- `context`: PR number and current branch

**Workflow Steps:**

1. **Step 0 - Ensure PR Exists**: Create PR using wiggum_complete_pr_creation tool
2. **Step 1 - Monitor Workflow**: Monitor GitHub Actions workflow completion
3. **Step 1b - Monitor PR Checks**: Monitor all PR status checks
4. **Step 2 - Code Quality**: Review and address code quality bot comments
5. **Step 3 - PR Review**: Execute comprehensive PR review
6. **Step 4 - Security Review**: Execute security review
7. **Step 4b - Verify Reviews**: Verify both reviews were executed
8. **Approval**: Post summary and approve PR

### wiggum_complete_pr_creation

Completes PR creation step with codified process.

**Inputs:**

- `pr_description` (string): Agent's description of PR contents and changes

**Behavior:**

- Extracts issue number from branch name (format: 123-feature-name)
- Gets commit messages from GitHub API
- Creates PR with "closes #issue" line + description + commits
- Posts confirmation comment
- Marks Step 0 complete
- Returns next step instructions

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

## Workflow State Management

### State Tracking

Wiggum tracks workflow progress through PR comments with embedded JSON state:

```json
<!-- wiggum-state:{"iteration":2,"step":"3","completedSteps":["0","1","1b","2"]} -->
```

Each PR comment includes:

- **iteration**: Current iteration count (max 10)
- **step**: Current step identifier
- **completedSteps**: Array of completed step identifiers

### State Transitions

The workflow follows a linear progression through steps:

```
Step 0 (Ensure PR)
  ↓
Step 1 (Monitor Workflow)
  ↓
Step 1b (Monitor PR Checks)
  ↓
Step 2 (Code Quality)
  ↓
Step 3 (PR Review)
  ↓
Step 4 (Security Review)
  ↓
Step 4b (Verify Reviews)
  ↓
Approval
```

If issues are found at any step, the workflow:

1. Increments the iteration counter
2. Returns Plan+Fix instructions
3. Upon fix completion, restarts from Step 1 (Monitor Workflow)
4. Continues until no issues are found or iteration limit is reached

## Error Handling

All tools implement comprehensive error handling:

### Error Categories

- **TimeoutError**: Operation exceeded time limit
- **ValidationError**: Invalid input parameters (terminal - not retryable)
- **NetworkError**: Network-related failures (retryable)
- **GitHubCliError**: GitHub CLI command failures
- **GitError**: Git command failures

### Error Logging

All errors are logged with proper context to enable debugging:

```typescript
catch (error) {
  console.error(`getMainBranch: failure message: ${error instanceof Error ? error.message : String(error)}`);
  // Proper error context is critical for troubleshooting
}
```

## Type Safety

### Discriminated Union for Steps

Steps use a discriminated union type (`WiggumStep`) instead of loose strings:

```typescript
export type WiggumStep = typeof STEP_ENSURE_PR | typeof STEP_MONITOR_WORKFLOW;
// ... other steps

export function isValidStep(step: unknown): step is WiggumStep {
  // Type guard for runtime validation
}
```

This prevents invalid step identifiers from being assigned.

### Type-Safe Result Objects

Tool results use strict type definitions without loose index signatures:

```typescript
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: ToolResultMeta; // Only defined properties
}
```

## Testing

### Test Framework

Uses Node.js built-in `node:test` module (no external dependencies):

```bash
npm test
```

### Test Coverage

Comprehensive test files cover:

- Input validation schemas
- Error handling
- Type safety
- State management
- Edge cases

Test files:

- `src/utils/errors.test.ts` - Error utilities
- `src/utils/git.test.ts` - Git operations
- `src/state/comments.test.ts` - PR comment parsing
- `src/state/detector.test.ts` - State detection
- `src/tools/next-step.test.ts` - Orchestration tool
- `src/tools/complete-pr-review.test.ts` - PR review completion
- `src/tools/complete-security-review.test.ts` - Security review completion
- `src/tools/complete-fix.test.ts` - Fix completion
- `src/constants.test.ts` - Step definitions and validation

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Type check
npm run typecheck

# Test
npm test
```

## Architecture

- `src/index.ts` - MCP server setup and tool registration
- `src/types.ts` - TypeScript type definitions (strict, no index signatures)
- `src/constants.ts` - Shared constants and type-safe step definitions
- `src/utils/errors.ts` - Error handling utilities with proper error context
- `src/utils/git.ts` - Git command utilities with comprehensive error handling
- `src/utils/gh-cli.ts` - GitHub CLI utilities
- `src/state/` - State detection and management
- `src/tools/` - Individual tool implementations
  - `init.ts` - Initialization/entry point tool
  - `complete-pr-creation.ts` - PR creation completion
  - `complete-pr-review.ts` - PR review completion
  - `complete-security-review.ts` - Security review completion
  - `complete-fix.ts` - Fix completion tracking

## Known Limitations

- Maximum 10 iterations per PR (prevents infinite loops)
- Requires `gh` (GitHub CLI) to be installed
- Requires `git` to be installed
- Network-dependent (GitHub API calls)
- Assumes standard branch naming (issue-number format)

## Future Improvements

- Add more granular error recovery strategies
- Implement parallel workflow execution for independent steps
- Add support for custom workflow rules per repository
- Implement workflow analytics and reporting
