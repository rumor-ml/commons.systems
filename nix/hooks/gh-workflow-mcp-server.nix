{ }:

''
  # Build gh-workflow-mcp-server if needed
  if [ -d "gh-workflow-mcp-server" ]; then
    if [ ! -f "gh-workflow-mcp-server/dist/index.js" ] || [ "gh-workflow-mcp-server/src/index.ts" -nt "gh-workflow-mcp-server/dist/index.js" ]; then
      echo "Building gh-workflow-mcp-server..."
      (cd gh-workflow-mcp-server && npm run build 2>&1 || true)
    fi
  fi
''
