#!/bin/bash
# Test a Go TUI app (unit + integration tests)
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

cd "$APP_PATH"

echo "--- Unit Tests ---"
go test -v ./cmd/... ./internal/...

echo ""
echo "--- Integration Tests ---"
if [[ -d "tests" ]]; then
  go test -v ./tests/...
else
  echo "Warning: No tests/ directory found, skipping integration tests"
fi

echo "Tests passed for $APP_NAME"
