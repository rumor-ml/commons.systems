#!/usr/bin/env bash
# Test a Firebase app - delegates to unified runner
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <app-path> [shard]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pass shard parameter if provided
if [ -n "$2" ]; then
  export PLAYWRIGHT_SHARD="$2"
fi

"${SCRIPT_DIR}/run-e2e-tests.sh" "firebase" "$1"
