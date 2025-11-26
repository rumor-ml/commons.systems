#!/bin/bash
# Test a Go fullstack app (build + E2E)
set -e

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
