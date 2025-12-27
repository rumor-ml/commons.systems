{ }:

''
  # MCP servers automatic rebuild hook
  # Rebuilds MCP servers when source files change (similar to pnpm hook)

  # Create build log directory
  mkdir -p /tmp/claude

  # Function to check if rebuild is needed
  needs_rebuild() {
    local server_dir="$1"
    local dist_file="$server_dir/dist/index.js"

    # If dist doesn't exist, rebuild needed
    if [ ! -f "$dist_file" ]; then
      return 0
    fi

    # Check if any source files are newer than dist
    # Check: src/**/*.ts, package.json, tsconfig.json
    local newer_files=$(find "$server_dir/src" -name "*.ts" -newer "$dist_file" 2>/dev/null)
    if [ -n "$newer_files" ]; then
      return 0
    fi

    if [ -f "$server_dir/package.json" ] && [ "$server_dir/package.json" -nt "$dist_file" ]; then
      return 0
    fi

    if [ -f "$server_dir/tsconfig.json" ] && [ "$server_dir/tsconfig.json" -nt "$dist_file" ]; then
      return 0
    fi

    return 1
  }

  # Function to build a single MCP server
  build_mcp_server() {
    local server_dir="$1"
    local server_name=$(basename "$server_dir")

    echo "Building $server_name..."
    if (cd "$server_dir" && npm run build > /tmp/claude/mcp-build.log 2>&1); then
      echo "  ✓ $server_name built successfully"
    else
      echo "  ⚠ Warning: $server_name build failed (check /tmp/claude/mcp-build.log)"
    fi
  }

  # Build all MCP servers if needed
  for server_dir in mcp-common wiggum-mcp-server gh-workflow-mcp-server gh-issue-mcp-server; do
    if [ -d "$server_dir" ]; then
      if needs_rebuild "$server_dir"; then
        build_mcp_server "$server_dir"
      fi
    fi
  done
''
