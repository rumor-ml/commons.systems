# GitHub Workflow MCP Server

MCP server for GitHub Actions workflow monitoring and automation.

## Features

This MCP server provides tools for:

- **Monitoring workflow runs** - Watch workflows until completion with real-time status updates
- **PR status checks** - Monitor all status checks for a pull request
- **Merge queue tracking** - Track PRs through the GitHub merge queue
- **Deployment URL extraction** - Extract deployment URLs from workflow logs
- **Failure diagnostics** - Get token-efficient summaries of workflow failures

## Installation

```bash
pnpm install
npm run build
```

## Prerequisites

- GitHub CLI (`gh`) must be installed and authenticated
- Node.js >= 18.0.0

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
    "gh-workflow": {
      "command": "node",
      "args": ["/path/to/gh-workflow-mcp-server/dist/index.js"]
    }
  }
}
```

## Available Tools

### `gh_monitor_run`

Monitor a GitHub Actions workflow run until completion.

**Inputs:**
- `run_id` (optional): Workflow run ID
- `pr_number` (optional): PR number to monitor
- `branch` (optional): Branch name to monitor
- `repo` (optional): Repository in format "owner/repo"
- `poll_interval_seconds` (optional): Polling interval (default: 10)
- `timeout_seconds` (optional): Maximum wait time (default: 600)

**Returns:** Structured summary with status, conclusion, duration, and job details.

### `gh_monitor_pr_checks`

Monitor all status checks for a pull request until they complete.

**Inputs:**
- `pr_number`: PR number to monitor
- `repo` (optional): Repository in format "owner/repo"
- `poll_interval_seconds` (optional): Polling interval (default: 10)
- `timeout_seconds` (optional): Maximum wait time (default: 600)

**Returns:** Summary of all checks with their status and conclusions.

### `gh_monitor_merge_queue`

Track a PR through the GitHub merge queue.

**Inputs:**
- `pr_number`: PR number to track
- `repo` (optional): Repository in format "owner/repo"
- `poll_interval_seconds` (optional): Polling interval (default: 15)
- `timeout_seconds` (optional): Maximum wait time (default: 1800)

**Returns:** Merge queue status and position updates.

### `gh_get_deployment_urls`

Extract deployment URLs from workflow run logs.

**Inputs:**
- `run_id` (optional): Workflow run ID
- `pr_number` (optional): PR number
- `branch` (optional): Branch name
- `repo` (optional): Repository in format "owner/repo"

**Returns:** List of deployment URLs found in logs.

### `gh_get_failure_details`

Get a token-efficient summary of workflow failures.

**Inputs:**
- `run_id` (optional): Workflow run ID
- `pr_number` (optional): PR number
- `branch` (optional): Branch name
- `repo` (optional): Repository in format "owner/repo"
- `max_chars` (optional): Maximum characters to return (default: 10000)

**Returns:** Concise summary of failures with relevant error messages.

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
- `src/utils/gh-cli.ts` - GitHub CLI wrapper for safe command execution
- `src/utils/errors.ts` - Error handling utilities
- `src/tools/` - Individual tool implementations
  - `monitor-run.ts` - Workflow run monitoring
  - `monitor-pr-checks.ts` - PR checks monitoring
  - `monitor-merge-queue.ts` - Merge queue tracking
  - `get-deployment-urls.ts` - Deployment URL extraction
  - `get-failure-details.ts` - Failure diagnostics
