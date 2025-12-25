# gh-issue-mcp-server: MCP server for GitHub Issue management
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
  mcp-common,
}:

buildNpmPackage {
  pname = "gh-issue-mcp-server";
  version = "0.1.0";

  # Filter source to remove build artifacts and preserve source files
  # Using builtins.path instead of lib.cleanSource to support git worktrees
  src = builtins.path {
    path = ../../gh-issue-mcp-server;
    name = "gh-issue-mcp-server-source";
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

  # Computed with: nix run nixpkgs#prefetch-npm-deps gh-issue-mcp-server/package-lock.json
  npmDepsHash = "sha256-v2zOKY1NLLoqVj/E6anArYbfS8Pn09jW0oK05jMUsHA=";

  # Link the built mcp-common package to satisfy file:../mcp-common reference
  # npm needs this directory to exist with package.json and dist/ for type resolution
  preBuild = ''
    mkdir -p ../mcp-common
    ln -s ${mcp-common}/lib/node_modules/@commons/mcp-common/* ../mcp-common/
  '';

  # Fix broken symlink created by npm during installation
  # Replace the symlink with actual mcp-common files from the Nix store
  postInstall = ''
    rm -rf $out/lib/node_modules/gh-issue-mcp-server/node_modules/@commons/mcp-common
    mkdir -p $out/lib/node_modules/gh-issue-mcp-server/node_modules/@commons
    cp -r ${mcp-common}/lib/node_modules/@commons/mcp-common $out/lib/node_modules/gh-issue-mcp-server/node_modules/@commons/
  '';

  meta = with lib; {
    description = "MCP server for GitHub Issue management";
    homepage = "https://github.com/commons-systems/gh-issue-mcp-server";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
