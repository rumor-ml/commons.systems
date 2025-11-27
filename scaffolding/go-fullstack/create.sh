#!/bin/bash
# Usage: ./scaffolding/go-fullstack/create.sh <app-name>

set -e

if [ -z "$1" ]; then
  echo "Usage: ./scaffolding/go-fullstack/create.sh <app-name>"
  exit 1
fi

APP_NAME="$1"

# Validate app name format
if [[ ! "$APP_NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Error: App name must start with lowercase letter, contain only a-z, 0-9, hyphens"
  exit 1
fi

# Check we're in the repository root
if [ ! -f "pnpm-workspace.yaml" ]; then
  echo "Error: Must run from repository root"
  exit 1
fi

# Check target doesn't exist
if [ -d "$APP_NAME" ]; then
  echo "Error: Directory '$APP_NAME' already exists"
  exit 1
fi

# Setup cleanup on failure
trap 'rm -rf "$APP_NAME"' ERR

APP_NAME_TITLE=$(echo "$APP_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')

echo "Creating Go full-stack app: $APP_NAME"
echo "Title: $APP_NAME_TITLE"

# 1. Copy template
echo "Copying template..."
cp -r scaffolding/go-fullstack/template "$APP_NAME"

# 2. Replace placeholders in all files
echo "Replacing placeholders..."
find "$APP_NAME" -type f \( -name "*.go" -o -name "*.mod" -o -name "*.templ" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.toml" -o -name "Dockerfile" -o -name "Makefile" -o -name "*.yaml" -o -name "*.yml" -o -name "*.css" -o -name "*.html" \) | while read -r file; do
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i.bak "s|{{APP_NAME}}|$APP_NAME|g" "$file"
    sed -i.bak "s|{{APP_NAME_TITLE}}|$APP_NAME_TITLE|g" "$file"
    rm -f "${file}.bak"
  else
    # Linux
    sed -i "s|{{APP_NAME}}|$APP_NAME|g" "$file"
    sed -i "s|{{APP_NAME_TITLE}}|$APP_NAME_TITLE|g" "$file"
  fi
done

# 3. Initialize Go modules (skip for now, requires Go tooling)
echo "Skipping Go module initialization (run 'go mod tidy' manually)"
# cd "$APP_NAME/site"
# go mod tidy || true
# cd ../..

# 4. Install npm dependencies (skip for now)
echo "Skipping npm install (run 'pnpm install' from repo root after adding to workspace)"
# cd "$APP_NAME/site"
# npm install
# cd ../..

# echo "Installing npm dependencies for tests..."
# cd "$APP_NAME/tests"
# npm install
# cd ../..

# 5. Update monorepo files
echo "Updating monorepo integration..."

# Add to pnpm-workspace.yaml
if ! grep -q "$APP_NAME/tests" pnpm-workspace.yaml; then
  echo "  - '$APP_NAME/tests'" >> pnpm-workspace.yaml
fi

# Add to root package.json scripts
if [ -f package.json ]; then
  echo "Note: Add these scripts to root package.json manually:"
  echo "  \"dev:$APP_NAME\": \"cd $APP_NAME/site && air\","
  echo "  \"build:$APP_NAME\": \"cd $APP_NAME/site && make build\","
  echo "  \"test:$APP_NAME\": \"pnpm test --workspace=$APP_NAME/tests\","
  echo "  \"test:$APP_NAME:deployed\": \"pnpm run test:deployed --workspace=$APP_NAME/tests\""
fi

echo ""
echo "✅ App created successfully!"
echo ""
echo "Next steps:"
echo "  1. cd $APP_NAME/site"
echo "  2. make dev"
echo "  3. Open http://localhost:8080"
echo ""
echo "Run tests:"
echo "  cd $APP_NAME/tests && npm test"
