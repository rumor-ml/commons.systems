# gh-workflow-mcp-server: MCP server for GitHub Workflow monitoring
# Built as a simple derivation that uses existing dist/ and node_modules/
{ lib
, stdenv
, nodejs
}:

stdenv.mkDerivation {
  pname = "gh-workflow-mcp-server";
  version = "0.1.0";

  # Use the local source directory without cleanSource to preserve dist/ and node_modules/
  # These are built imperatively but we package them here
  src = ../../gh-workflow-mcp-server;

  # Don't clean anything - we need dist/ and node_modules/ from the source
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
