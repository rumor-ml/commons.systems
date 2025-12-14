#!/bin/bash
# Legacy test runner - delegates to new unified test.sh
# Usage:
#   run-tests.sh              # Test all apps
#   run-tests.sh <app-name>   # Test single app
#   run-tests.sh --type=firebase  # Test all apps of type
#
# NOTE: This script is maintained for backward compatibility.
#       Use ./test or infrastructure/scripts/test.sh for new features.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse arguments and convert to new test.sh format
ARGS=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --type=*)
      ARGS+=("--type=${1#*=}")
      shift
      ;;
    --help|-h)
      ARGS+=("$1")
      shift
      ;;
    --*)
      # Pass through other flags
      ARGS+=("$1")
      shift
      ;;
    *)
      # Convert positional app-name to --module=app-name
      ARGS+=("--module=$1")
      shift
      ;;
  esac
done

# Delegate to new test.sh
exec "${SCRIPT_DIR}/test.sh" "${ARGS[@]}"
