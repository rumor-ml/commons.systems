#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scaffold.sh <service-name>
# Example: ./scaffold.sh gh-workflow

if [ $# -ne 1 ]; then
  echo "Usage: $0 <service-name>"
  echo "Example: $0 gh-workflow"
  exit 1
fi

SERVICE="$1"
SERVICE_UPPER=$(echo "$SERVICE" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
SERVICE_TITLE=$(echo "$SERVICE" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')

TARGET_DIR="../../${SERVICE}-mcp-server"
NIX_PKG_DIR="../../nix/packages"

if [ -d "$TARGET_DIR" ]; then
  echo "Error: Directory $TARGET_DIR already exists"
  exit 1
fi

echo "Creating MCP server: ${SERVICE}-mcp-server"
echo "  Service name: $SERVICE"
echo "  Service upper: $SERVICE_UPPER"
echo "  Service title: $SERVICE_TITLE"
echo "  Target directory: $TARGET_DIR"
echo ""

# Create target directory structure
mkdir -p "$TARGET_DIR/src/utils"
mkdir -p "$TARGET_DIR/src/tools"

# Copy and process template files
for template_file in $(find template -type f); do
  relative_path="${template_file#template/}"
  target_file="$TARGET_DIR/$relative_path"
  target_dir=$(dirname "$target_file")

  mkdir -p "$target_dir"

  # Replace placeholders
  sed -e "s/{{SERVICE}}/$SERVICE/g" \
      -e "s/{{SERVICE_UPPER}}/$SERVICE_UPPER/g" \
      -e "s/{{SERVICE_TITLE}}/$SERVICE_TITLE/g" \
      "$template_file" > "$target_file"

  echo "Created: $target_file"
done

# Create Nix package file
echo ""
echo "Creating Nix package..."
NIX_TEMPLATE="template-nix/mcp-server.nix"
NIX_TARGET="$NIX_PKG_DIR/${SERVICE}-mcp-server.nix"

if [ ! -d "$NIX_PKG_DIR" ]; then
  echo "Error: Nix packages directory $NIX_PKG_DIR does not exist"
  exit 1
fi

sed -e "s/{{SERVICE}}/$SERVICE/g" \
    -e "s/{{SERVICE_UPPER}}/$SERVICE_UPPER/g" \
    -e "s/{{SERVICE_TITLE}}/$SERVICE_TITLE/g" \
    "$NIX_TEMPLATE" > "$NIX_TARGET"

echo "Created: $NIX_TARGET"

# Make sure package.json exists
if [ ! -f "$TARGET_DIR/package.json" ]; then
  echo "Error: package.json was not created"
  exit 1
fi

# Generate package-lock.json
echo ""
echo "Generating package-lock.json..."
cd "$TARGET_DIR"
npm install --package-lock-only
cd - > /dev/null
echo "Created: $TARGET_DIR/package-lock.json"

echo ""
echo "Scaffolding complete!"
echo ""
echo "Next steps:"
echo ""
echo "1. Add to pnpm workspace:"
echo "   Add '\"${SERVICE}-mcp-server\"' to pnpm-workspace.yaml"
echo ""
echo "2. Compute Nix npmDepsHash:"
echo "   nix run nixpkgs#prefetch-npm-deps ${SERVICE}-mcp-server/package-lock.json"
echo ""
echo "3. Update Nix package with hash:"
echo "   Edit $NIX_TARGET"
echo "   Replace 'sha256-REPLACE_ME' with the computed hash"
echo ""
echo "4. Add package to flake.nix:"
echo "   a. Add to packages section:"
echo "      ${SERVICE}-mcp-server = pkgs.callPackage ./nix/packages/${SERVICE}-mcp-server.nix { };"
echo "   b. Add to dev shell buildInputs:"
echo "      ${SERVICE}-mcp-server"
echo "   c. Add to flake outputs (if needed):"
echo "      packages.\${system}.${SERVICE}-mcp-server = ${SERVICE}-mcp-server;"
echo ""
echo "5. Add to .mcp.json configuration"
echo ""
echo "6. Enable in .claude/settings.json if needed"
echo ""
echo "7. Run 'pnpm install' from the monorepo root"
echo ""
echo "8. Implement your tools in $TARGET_DIR/src/tools/"
echo ""
echo "9. Build and test:"
echo "   cd $TARGET_DIR && npm run build"
echo "   node $TARGET_DIR/dist/index.js"
