{ }:

''
  # gh-workflow-mcp-server is built by Nix derivation, not shell hook
  # This just confirms it's available in the shell environment
  if command -v gh-workflow-mcp-server > /dev/null 2>&1; then
    # Binary available from Nix package in PATH
    :
  fi
''
