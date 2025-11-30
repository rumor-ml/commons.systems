# MCP Server Scaffolding

This directory contains a template for creating new MCP (Model Context Protocol) servers.

## Usage

To create a new MCP server:

```bash
cd scaffolding/mcp-server
./scaffold.sh <service-name>
```

For example:
```bash
./scaffold.sh gh-workflow
```

This will create a new directory `../../<service-name>-mcp-server/` with all the necessary files.

## Template Structure

```
template/
├── package.json          # Package configuration with {{SERVICE}} placeholders
├── tsconfig.json         # TypeScript configuration
├── .gitignore           # Git ignore rules
├── README.md            # Service-specific README
└── src/
    ├── index.ts         # MCP server entry point
    ├── types.ts         # TypeScript type definitions
    ├── constants.ts     # Shared constants
    └── utils/
        └── errors.ts    # Error handling utilities
```

## What Gets Replaced

The scaffold script will replace the following placeholders:
- `{{SERVICE}}` - Your service name (e.g., "gh-workflow")
- `{{SERVICE_UPPER}}` - Uppercase service name (e.g., "GH_WORKFLOW")
- `{{SERVICE_TITLE}}` - Title case service name (e.g., "GitHub Workflow")

## After Scaffolding

1. Add your service to the pnpm workspace in `pnpm-workspace.yaml`
2. Run `pnpm install` from the monorepo root
3. Implement your MCP tools in the `src/tools/` directory
4. Update the README.md with your service-specific documentation
5. Build with `npm run build`
6. Test locally with `node dist/index.js`
