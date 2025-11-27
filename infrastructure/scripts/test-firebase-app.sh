#!/bin/bash
# Test a Firebase app (lint + build + E2E)
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

echo "--- Lint Checks ---"
if grep -r "console\.log" "${APP_PATH}/site/src/" 2>/dev/null; then
  echo "Error: Found console.log statements"
  exit 1
fi
echo "No console.log statements found"

echo ""
echo "--- Building ---"
pnpm --filter "${APP_NAME}/site" build

echo ""
echo "--- E2E Tests ---"
cd "${APP_PATH}/tests"
CI=true npx playwright test --project chromium

echo "Tests passed for $APP_NAME"
