#!/bin/bash
# Test a Go fullstack app (build + E2E)
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <app-path>"
  exit 1
fi

if [ ! -d "$1" ]; then
  echo "Error: Directory '$1' does not exist"
  exit 1
fi

APP_PATH="$1"
APP_NAME=$(basename "$APP_PATH")

cd "${APP_PATH}/site"

echo "--- Building ---"
make build

echo ""
echo "--- E2E Tests ---"
cd "../tests"
CI=true npx playwright test --project chromium

echo "Tests passed for $APP_NAME"
