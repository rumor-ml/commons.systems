# Gh Issue MCP Server

MCP server for Gh Issue operations.

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
    "gh-issue": {
      "command": "node",
      "args": ["/path/to/gh-issue-mcp-server/dist/index.js"]
    }
  }
}
```

## Available Tools

TODO: Document your tools here

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
