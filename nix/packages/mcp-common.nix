# mcp-common: Shared error classes and types for MCP servers
#
# This package provides common utilities for MCP (Model Context Protocol) servers:
# - Error class hierarchy (TimeoutError, ValidationError, NetworkError, etc.)
# - Type definitions (ToolResult, ToolSuccess, ToolError)
# - Result builder utilities
#
# Build process:
# - buildNpmPackage automatically runs: npm ci && npm run build
# - The build script in package.json is "tsc" (TypeScript compilation)
# - Outputs to dist/ directory with .js, .d.ts, and source map files
#
{
  lib,
  buildNpmPackage,
}:

buildNpmPackage {
  pname = "mcp-common";
  version = "0.1.0";

  # Include all source files (no dist/ since it's not git-tracked)
  src = builtins.path {
    path = ../../mcp-common;
    name = "mcp-common-source";
    filter =
      path: type:
      let
        baseName = baseNameOf path;
      in
      # Exclude build artifacts, git, and temp files
      baseName != ".git"
      && baseName != "node_modules"
      && baseName != "dist"
      && baseName != ".direnv"
      && !(lib.hasSuffix ".swp" baseName)
      && !(lib.hasSuffix "~" baseName);
  };

  # Computed with: nix run nixpkgs#prefetch-npm-deps mcp-common/package-lock.json
  npmDepsHash = "sha256-nZYi5JlMhAJGrzWCrUTBXWxwdK5TozeXO6pgiOkS/0E=";

  # Simple build - just TypeScript compilation
  # buildNpmPackage handles: npm ci && npm run build
  # No special hooks needed since there are no workspace dependencies

  meta = with lib; {
    description = "Shared error classes and types for MCP servers";
    homepage = "https://github.com/commons-systems/mcp-common";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
