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

# Make sure package.json exists
if [ ! -f "$TARGET_DIR/package.json" ]; then
  echo "Error: package.json was not created"
  exit 1
fi

echo ""
echo "Scaffolding complete!"
echo ""
echo "Next steps:"
echo "  1. Add '\"${SERVICE}-mcp-server\"' to pnpm-workspace.yaml"
echo "  2. Run 'pnpm install' from the monorepo root"
echo "  3. Implement your tools in $TARGET_DIR/src/tools/"
echo "  4. Build with: cd $TARGET_DIR && npm run build"
echo "  5. Test with: node $TARGET_DIR/dist/index.js"
