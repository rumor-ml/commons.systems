#!/usr/bin/env bash
# Test a Go TUI app - delegates to unified runner
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <app-path>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/run-e2e-tests.sh" "go-tui" "$1"
