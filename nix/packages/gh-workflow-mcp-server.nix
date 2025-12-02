# gh-workflow-mcp-server: MCP server for GitHub Workflow monitoring
#
# This package uses stdenv.mkDerivation instead of buildGoModule or buildNpmPackage
# because it packages a pre-built artifact rather than building from source.
#
# Why stdenv.mkDerivation (not buildGoModule):
# - This is a Node.js/TypeScript project, not a Go project
# - The TypeScript source is already compiled to JavaScript (in dist/)
# - Dependencies are already installed (in node_modules/)
# - We're packaging the pre-built artifacts, not building from source
#
# Pre-built artifact approach:
# - The dist/ directory contains compiled JavaScript from TypeScript source
# - The node_modules/ directory contains runtime dependencies
# - We copy these artifacts into the Nix store as-is
# - This is faster than rebuilding but requires dist/ and node_modules/ to exist
#
# Alternative approach (not used here):
# - Could use buildNpmPackage to build from source
# - Would require fetching dependencies via npm registry
# - More reproducible but slower and more complex
#
# Wrapper purpose:
# - Creates a shell script that invokes Node.js with the correct entry point
# - Ensures the package can find its dependencies in node_modules/
# - Makes the tool executable from anywhere via $PATH
#
{ lib
, stdenv
, nodejs
}:

stdenv.mkDerivation {
  pname = "gh-workflow-mcp-server";
  version = "0.1.0";

  # Use the local source directory without cleanSource to preserve dist/ and node_modules/
  # These directories are built imperatively (pnpm build) but packaged here
  src = ../../gh-workflow-mcp-server;

  # Skip build phase - we're using pre-built artifacts
  dontBuild = true;

  installPhase = ''
    # Create output directories
    mkdir -p $out/bin $out/lib/gh-workflow-mcp-server

    # Copy everything we need (dist/ and node_modules/ are in source)
    cp -r dist $out/lib/gh-workflow-mcp-server/
    cp -r node_modules $out/lib/gh-workflow-mcp-server/
    cp package.json $out/lib/gh-workflow-mcp-server/

    # Create executable wrapper
    cat > $out/bin/gh-workflow-mcp-server <<EOF
#!/usr/bin/env bash
exec ${nodejs}/bin/node $out/lib/gh-workflow-mcp-server/dist/index.js "\$@"
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
