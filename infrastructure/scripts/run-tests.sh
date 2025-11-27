#!/bin/bash
# Unified test runner - discovers and tests all apps
# Usage:
#   run-tests.sh              # Test all apps
#   run-tests.sh <app-name>   # Test single app
#   run-tests.sh --type=firebase  # Test all apps of type

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Parse arguments
APP_FILTER=""
TYPE_FILTER=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --type=*) TYPE_FILTER="${1#*=}"; shift ;;
    *) APP_FILTER="$1"; shift ;;
  esac
done

# Discover apps
source "$SCRIPT_DIR/discover-apps.sh"
APPS=$(discover_apps "$ROOT_DIR" "$TYPE_FILTER" "$APP_FILTER")

if [ -z "$APPS" ]; then
  echo "No apps found matching criteria"
  exit 1
fi

echo "=== Running Tests ==="
FAILED=0

while IFS=: read -r app_name app_type app_path; do
  echo ""
  echo "=========================================="
  echo "Testing: $app_name ($app_type)"
  echo "=========================================="

  case "$app_type" in
    firebase)
      "$SCRIPT_DIR/test-firebase-app.sh" "$app_path" || FAILED=1
      ;;
    go-tui)
      "$SCRIPT_DIR/test-go-tui-app.sh" "$app_path" || FAILED=1
      ;;
    go-fullstack)
      "$SCRIPT_DIR/test-go-fullstack-app.sh" "$app_path" || FAILED=1
      ;;
    go-package)
      "$SCRIPT_DIR/test-go-package.sh" "$app_path" || FAILED=1
      ;;
  esac
done <<< "$APPS"

if [ $FAILED -eq 1 ]; then
  echo ""
  echo "Some tests failed!"
  exit 1
fi

echo ""
echo "All tests passed!"
