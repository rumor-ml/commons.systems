#!/bin/bash
# Test a Firebase app (lint + build + E2E)
set -e

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
npm run build --workspace="${APP_NAME}/site"

echo ""
echo "--- E2E Tests ---"
cd "${APP_PATH}/tests"
CI=true npx playwright test --project chromium

echo "Tests passed for $APP_NAME"
