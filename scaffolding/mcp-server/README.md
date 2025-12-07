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

template-nix/
└── mcp-server.nix       # Nix package template using buildNpmPackage
```

## What Gets Replaced

The scaffold script will replace the following placeholders:
- `{{SERVICE}}` - Your service name (e.g., "gh-workflow")
- `{{SERVICE_UPPER}}` - Uppercase service name (e.g., "GH_WORKFLOW")
- `{{SERVICE_TITLE}}` - Title case service name (e.g., "GitHub Workflow")

## After Scaffolding

The scaffold script creates both the TypeScript project and a Nix package template. Follow these steps to complete the integration:

### 1. Add to pnpm Workspace

Edit `pnpm-workspace.yaml` and add your new service:

```yaml
packages:
  - "your-service-mcp-server"
```

### 2. Compute Nix npmDepsHash

The Nix package needs the hash of your npm dependencies. Compute it with:

```bash
nix run nixpkgs#prefetch-npm-deps your-service-mcp-server/package-lock.json
```

This will output a hash like: `sha256-abc123...`

### 3. Update Nix Package with Hash

Edit `nix/packages/your-service-mcp-server.nix` and replace:

```nix
npmDepsHash = "sha256-REPLACE_ME";
```

with the computed hash:

```nix
npmDepsHash = "sha256-abc123...";
```

### 4. Add Package to flake.nix

Edit `flake.nix` and add your package in multiple locations:

#### a. In the `packages` section (around line 200):

```nix
your-service-mcp-server = pkgs.callPackage ./nix/packages/your-service-mcp-server.nix { };
```

#### b. In the `devShells.default` buildInputs (around line 250):

```nix
buildInputs = [
  # ... other packages
  your-service-mcp-server
];
```

#### c. In the flake outputs `packages` (around line 300):

```nix
packages.${system}.your-service-mcp-server = your-service-mcp-server;
```

### 5. Add to .mcp.json Configuration

Edit `.mcp.json` to register your MCP server:

```json
{
  "mcpServers": {
    "your-service": {
      "command": "your-service-mcp-server",
      "args": []
    }
  }
}
```

### 6. Enable in Claude Code Settings (if needed)

If you want Claude Code to use your server, edit `.claude/settings.json`:

```json
{
  "mcpServers": {
    "your-service": {
      "command": "your-service-mcp-server",
      "args": []
    }
  }
}
```

### 7. Install Dependencies

Run from the monorepo root:

```bash
pnpm install
```

### 8. Implement Your Tools

Add your MCP tool implementations in `your-service-mcp-server/src/tools/`.

You can use `src/tools/example-tool.ts.example` as a reference.

### 9. Build and Test

Build the TypeScript project:

```bash
cd your-service-mcp-server
npm run build
```

Test the MCP server:

```bash
node dist/index.js
```

### 10. Verify Nix Build

Test that the Nix package builds correctly:

```bash
nix build .#your-service-mcp-server
```

The built binary will be available in `result/bin/your-service-mcp-server`.
