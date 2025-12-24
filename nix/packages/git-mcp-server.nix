# git-mcp-server: MCP server for Git operations
#
# This package uses buildNpmPackage to build from source rather than packaging
# pre-built artifacts. This provides a more reproducible and idiomatic Nix approach.
#
# Build process:
# - buildNpmPackage automatically runs: npm ci && npm run build
# - The build script in package.json is "tsc" (TypeScript compilation)
# - builtins.path removes .gitignore'd files (dist/, node_modules/)
# - npmDepsHash is computed from package-lock.json dependencies
# - The package.json bin entry is automatically handled by buildNpmPackage
#
{
  lib,
  buildNpmPackage,
}:

buildNpmPackage {
  pname = "git-mcp-server";
  version = "0.1.0";

  # Filter source to remove build artifacts and preserve source files
  # Using builtins.path instead of lib.cleanSource to support git worktrees
  src = builtins.path {
    path = ../../git-mcp-server;
    name = "git-mcp-server-source";
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

  # Computed with: nix run nixpkgs#prefetch-npm-deps git-mcp-server/package-lock.json
  npmDepsHash = "sha256-sa9IDaqFqGN+URcx4XR7pu32ori+jsMfNLNNlB6G0rg=";

  meta = with lib; {
    description = "MCP server for Git operations";
    homepage = "https://github.com/commons-systems/git-mcp-server";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
