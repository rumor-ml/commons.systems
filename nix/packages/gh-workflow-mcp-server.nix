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
#
# Wrapper purpose:
# - Creates a shell script that invokes Node.js with the correct entry point
# - Ensures the package can find its dependencies in node_modules/
# - Makes the tool executable from anywhere via $PATH
#
{ lib
, buildNpmPackage
, nodejs
}:

buildNpmPackage {
  pname = "gh-workflow-mcp-server";
  version = "0.1.0";

  # Use lib.cleanSource to remove build artifacts and preserve source files
  src = lib.cleanSource ../../gh-workflow-mcp-server;

  # Computed with: nix run nixpkgs#prefetch-npm-deps package-lock.json
  npmDepsHash = "sha256-/gb/AnDr63ggwG3Ug6yT+T3+eJGd4zH7+xKkCNdfntw=";

  # buildNpmPackage automatically runs: npm ci && npm run build
  # The build script in package.json is "tsc" (TypeScript compilation)

  # Install the compiled output and create wrapper script
  postInstall = ''
    mkdir -p $out/bin
    cat > $out/bin/gh-workflow-mcp-server <<EOF
#!/usr/bin/env bash
exec ${nodejs}/bin/node $out/lib/node_modules/gh-workflow-mcp-server/dist/index.js "\$@"
EOF
    chmod +x $out/bin/gh-workflow-mcp-server
  '';

  meta = with lib; {
    description = "MCP server for GitHub Workflow monitoring";
    homepage = "https://github.com/commons-systems/gh-workflow-mcp-server";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
