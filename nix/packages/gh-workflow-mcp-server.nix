# gh-workflow-mcp-server: MCP server for GitHub Workflow monitoring
#
# This package uses buildNpmPackage to build from source rather than packaging
# pre-built artifacts. This provides a more reproducible and idiomatic Nix approach.
#
# Build process:
# - buildNpmPackage automatically runs: npm ci && npm run build
# - The build script in package.json is "tsc" (TypeScript compilation)
# - lib.cleanSource removes .gitignore'd files (dist/, node_modules/)
# - npmDepsHash is computed from package-lock.json dependencies
# - The package.json bin entry is automatically handled by buildNpmPackage
#
{
  lib,
  buildNpmPackage,
}:

buildNpmPackage {
  pname = "gh-workflow-mcp-server";
  version = "0.1.0";

  # Filter source to remove build artifacts and preserve source files
  # Using builtins.path instead of lib.cleanSource to support git worktrees
  src = builtins.path {
    path = ../../gh-workflow-mcp-server;
    name = "gh-workflow-mcp-server-source";
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

  # Computed with: nix run nixpkgs#prefetch-npm-deps package-lock.json
  npmDepsHash = "sha256-jQW8gX94acerRhW64l3X69MVdz1qpLDPuzckzvL4sdI=";

  meta = with lib; {
    description = "MCP server for GitHub Workflow monitoring";
    homepage = "https://github.com/commons-systems/gh-workflow-mcp-server";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
