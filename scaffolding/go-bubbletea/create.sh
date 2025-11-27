#!/bin/bash
# Usage: ./scaffolding/go-bubbletea/create.sh <app-name>

set -e

if [ -z "$1" ]; then
  echo "Usage: ./scaffolding/go-bubbletea/create.sh <app-name>"
  exit 1
fi

APP_NAME="$1"
APP_NAME_TITLE=$(echo "$APP_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')

echo "Creating Go/Bubbletea TUI app: $APP_NAME"
echo "Title: $APP_NAME_TITLE"

# 1. Copy template
echo "Copying template..."
cp -r scaffolding/go-bubbletea/template "$APP_NAME"

# 2. Rename cmd directory
mv "$APP_NAME/cmd/app" "$APP_NAME/cmd/$APP_NAME"

# 3. Replace placeholders in all files
echo "Replacing placeholders..."
find "$APP_NAME" -type f \( -name "*.go" -o -name "*.mod" -o -name "Makefile" -o -name "*.md" \) | while read -r file; do
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

# 4. Initialize Go modules
echo "Initializing Go modules..."
cd "$APP_NAME"
go mod tidy || echo "Note: Run 'go mod tidy' manually if needed"
cd ..

echo ""
echo "App created successfully!"
echo ""
echo "Next steps:"
echo "  1. cd $APP_NAME"
echo "  2. make dev"
echo ""
echo "Run tests:"
echo "  ./infrastructure/scripts/run-tests.sh $APP_NAME"
echo ""
echo "The test framework will auto-discover this app by convention."
