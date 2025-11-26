#!/bin/bash
# Test a Go TUI app (unit + integration tests)
set -e

APP_PATH="$1"
APP_NAME=$(basename "$APP_PATH")

cd "$APP_PATH"

echo "--- Unit Tests ---"
go test -v ./cmd/... ./internal/...

echo ""
echo "--- Integration Tests ---"
if [[ -d "tests" ]]; then
  go test -v ./tests/...
fi

echo "Tests passed for $APP_NAME"
