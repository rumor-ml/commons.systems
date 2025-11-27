#!/bin/bash
# Usage: ./scaffolding/firebase/create.sh <app-name>

set -e

if [ -z "$1" ]; then
  echo "Usage: ./scaffolding/firebase/create.sh <app-name>"
  exit 1
fi

APP_NAME="$1"
APP_NAME_TITLE=$(echo "$APP_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')

echo "Creating Firebase app: $APP_NAME"
echo "Title: $APP_NAME_TITLE"

# 1. Copy template
echo "Copying template..."
cp -r scaffolding/firebase/template "$APP_NAME"

# 2. Replace placeholders in all files
echo "Replacing placeholders..."
find "$APP_NAME" -type f \( -name "*.html" -o -name "*.css" -o -name "*.js" -o -name "*.ts" -o -name "*.json" -o -name "Dockerfile" -o -name "*.conf" \) | while read -r file; do
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i.bak "s/{{APP_NAME}}/$APP_NAME/g" "$file"
    sed -i.bak "s/{{APP_NAME_TITLE}}/$APP_NAME_TITLE/g" "$file"
    rm -f "${file}.bak"
  else
    # Linux
    sed -i "s/{{APP_NAME}}/$APP_NAME/g" "$file"
    sed -i "s/{{APP_NAME_TITLE}}/$APP_NAME_TITLE/g" "$file"
  fi
done

# 3. Update monorepo files
echo "Updating monorepo integration..."

# Add to pnpm-workspace.yaml
if ! grep -q "$APP_NAME/site" pnpm-workspace.yaml; then
  echo "  - '$APP_NAME/site'" >> pnpm-workspace.yaml
fi
if ! grep -q "$APP_NAME/tests" pnpm-workspace.yaml; then
  echo "  - '$APP_NAME/tests'" >> pnpm-workspace.yaml
fi

echo ""
echo "App created successfully!"
echo ""
echo "Next steps:"
echo "  1. Run 'pnpm install' from repo root"
echo "  2. cd $APP_NAME/site && pnpm dev"
echo "  3. Open http://localhost:3000"
echo ""
echo "Run tests:"
echo "  ./infrastructure/scripts/run-tests.sh $APP_NAME"
echo ""
echo "The test framework will auto-discover this app by convention."
