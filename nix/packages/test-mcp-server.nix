# test-mcp-server: MCP server for test execution and infrastructure management
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
  mcp-common,
}:

buildNpmPackage {
  pname = "test-mcp-server";
  version = "0.1.0";

  # Filter source to remove build artifacts and preserve source files
  # Using builtins.path instead of lib.cleanSource to support git worktrees
  src = builtins.path {
    path = ../../test-mcp-server;
    name = "test-mcp-server-source";
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
  npmDepsHash = "sha256-08LP33IVC1BdxgYL+shM80G4EC3cJ2SIMU1t+iMgh1g=";

  # Link the built mcp-common package to satisfy file:../mcp-common reference
  # npm needs this directory to exist with package.json and dist/ for type resolution
  preBuild = ''
    mkdir -p ../mcp-common
    ln -s ${mcp-common}/lib/node_modules/@commons/mcp-common/* ../mcp-common/
  '';

  # Fix broken symlink created by npm during installation
  # Replace the symlink with actual mcp-common files from the Nix store
  postInstall = ''
    rm -rf $out/lib/node_modules/test-mcp-server/node_modules/@commons/mcp-common
    mkdir -p $out/lib/node_modules/test-mcp-server/node_modules/@commons
    cp -r ${mcp-common}/lib/node_modules/@commons/mcp-common $out/lib/node_modules/test-mcp-server/node_modules/@commons/
  '';

  meta = with lib; {
    description = "MCP server for test execution and infrastructure management";
    homepage = "https://github.com/commons-systems/test-mcp-server";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
