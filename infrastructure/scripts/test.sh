#!/bin/bash
# Unified test CLI - main entry point
# Usage:
#   ./test                                    # All tests
#   ./test --module=printsync,fellspiral      # Filter by module
#   ./test --type=unit|e2e|deployed-e2e       # Filter by test type
#   ./test --file="auth-flow"                 # Filter by file pattern
#   ./test --filter="login flow"              # Filter by test name
#   ./test --changed-only                     # Only changed modules vs main
#   ./test --list                             # Dry run
#   ./test --ci                               # CI mode (JSON output)
#   ./test --module=printsync -- --headed     # Pass-through to framework

set -e

# Resolve actual script location (not symlink)
SCRIPT_PATH="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_PATH" ]; do
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
  [[ "$SCRIPT_PATH" != /* ]] && SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_PATH"
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source helper libraries
source "${SCRIPT_DIR}/test-lib/discover.sh"
source "${SCRIPT_DIR}/test-lib/filter.sh"
source "${SCRIPT_DIR}/test-lib/output.sh"
source "${SCRIPT_DIR}/test-lib/runners/firebase.sh"
source "${SCRIPT_DIR}/test-lib/runners/go-fullstack.sh"
source "${SCRIPT_DIR}/test-lib/runners/go-tui.sh"
source "${SCRIPT_DIR}/test-lib/runners/go-package.sh"
source "${SCRIPT_DIR}/test-lib/runners/mcp-server.sh"

# Parse arguments
MODULE_FILTER=""
TYPE_FILTER=""
FILE_PATTERN=""
NAME_FILTER=""
CHANGED_ONLY=false
DRY_RUN=false
CI_MODE=false
EXTRA_ARGS=""
PARSE_EXTRA=false

for arg in "$@"; do
  if [[ "$PARSE_EXTRA" == true ]]; then
    EXTRA_ARGS="$EXTRA_ARGS $arg"
    continue
  fi

  case "$arg" in
    --module=*)
      MODULE_FILTER="${arg#*=}"
      ;;
    --type=*)
      TYPE_FILTER="${arg#*=}"
      ;;
    --file=*)
      FILE_PATTERN="${arg#*=}"
      ;;
    --filter=*)
      NAME_FILTER="${arg#*=}"
      ;;
    --changed-only)
      CHANGED_ONLY=true
      ;;
    --list)
      DRY_RUN=true
      ;;
    --ci)
      CI_MODE=true
      OUTPUT_MODE="json"
      ;;
    --)
      PARSE_EXTRA=true
      ;;
    --help|-h)
      cat <<EOF
Unified Test CLI

Usage:
  ./test [options] [-- extra-args]

Options:
  --module=<name>[,<name>...]   Filter by module names (comma-separated)
  --type=<type>                 Filter by test type (unit|e2e|deployed-e2e)
  --file=<pattern>              Filter by file pattern
  --filter=<pattern>            Filter by test name pattern
  --changed-only                Only test modules changed vs main branch
  --list                        Dry run - list modules without running tests
  --ci                          CI mode - JSON output
  --                            Pass remaining args to test framework
  --help, -h                    Show this help

Examples:
  ./test                                      # Run all tests
  ./test --module=printsync                   # Test printsync only
  ./test --type=unit                          # Run all unit tests
  ./test --changed-only                       # Test only changed modules
  ./test --module=printsync --type=e2e        # Printsync E2E tests
  ./test --module=printsync -- --headed       # Pass --headed to Playwright
  ./test --file="auth-flow"                   # Test files matching pattern
  ./test --filter="login flow"                # Test names matching pattern

EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Handle --changed-only
if [[ "$CHANGED_ONLY" == true ]]; then
  MODULE_FILTER=$(get_changed_modules "$ROOT_DIR")
  if [[ -z "$MODULE_FILTER" ]]; then
    echo "No changed modules detected"
    exit 0
  fi
  echo "Changed modules: $MODULE_FILTER"
fi

# Discover modules
MODULES=$(discover_all_modules "$ROOT_DIR" "" "")

if [[ -z "$MODULES" ]]; then
  echo "No modules found"
  exit 1
fi

# Apply filters
FILTERED_MODULES=""
while IFS=: read -r name type path; do
  # Filter by module name
  if ! filter_by_modules "$MODULE_FILTER" "$name"; then
    continue
  fi

  # If type filter specified, skip modules that don't support it
  if [[ -n "$TYPE_FILTER" ]] && ! supports_test_type "$type" "$TYPE_FILTER"; then
    continue
  fi

  # Add to filtered list
  if [[ -z "$FILTERED_MODULES" ]]; then
    FILTERED_MODULES="$name:$type:$path"
  else
    FILTERED_MODULES="$FILTERED_MODULES
$name:$type:$path"
  fi
done <<< "$MODULES"

if [[ -z "$FILTERED_MODULES" ]]; then
  echo "No modules match the specified filters"
  exit 0
fi

# Dry run mode
if [[ "$DRY_RUN" == true ]]; then
  if [[ "$CI_MODE" == true ]]; then
    # JSON output with test types
    discover_all_modules_json "$ROOT_DIR" "$TYPE_FILTER" ""
  else
    # Text output
    output_list_modules "$FILTERED_MODULES"
  fi
  exit 0
fi

# Run tests
output_start "$OUTPUT_MODE"

EXIT_CODE=0

while IFS=: read -r name type path; do
  # Determine which test types to run
  TEST_TYPES=()

  if [[ -n "$TYPE_FILTER" ]]; then
    # Explicit type filter
    TEST_TYPES=("$TYPE_FILTER")
  else
    # Run all supported test types
    case "$type" in
      firebase)
        TEST_TYPES=("e2e")
        ;;
      go-fullstack)
        TEST_TYPES=("unit" "e2e")
        ;;
      go-tui)
        TEST_TYPES=("unit" "e2e")
        ;;
      go-package|mcp-server)
        TEST_TYPES=("unit")
        ;;
    esac
  fi

  # Run each test type
  for test_type in "${TEST_TYPES[@]}"; do
    output_test_header "$name" "$type" "$test_type"

    # Build filter arguments
    FILTER_ARGS=$(build_filter_args "$test_type" "$FILE_PATTERN" "$NAME_FILTER")

    # Run tests via appropriate runner
    TEST_OUTPUT=""
    TEST_STATUS="passed"

    case "$type" in
      firebase)
        TEST_OUTPUT_FILE=$(mktemp)
        if ! run_firebase_tests "$path" "$test_type" "$FILTER_ARGS" "$EXTRA_ARGS" > "$TEST_OUTPUT_FILE" 2>&1; then
          TEST_STATUS="failed"
          EXIT_CODE=1
        fi
        TEST_OUTPUT=$(cat "$TEST_OUTPUT_FILE")
        rm -f "$TEST_OUTPUT_FILE"
        ;;
      go-fullstack)
        TEST_OUTPUT_FILE=$(mktemp)
        if ! run_go_fullstack_tests "$path" "$test_type" "$FILTER_ARGS" "$EXTRA_ARGS" > "$TEST_OUTPUT_FILE" 2>&1; then
          TEST_STATUS="failed"
          EXIT_CODE=1
        fi
        TEST_OUTPUT=$(cat "$TEST_OUTPUT_FILE")
        rm -f "$TEST_OUTPUT_FILE"
        ;;
      go-tui)
        TEST_OUTPUT_FILE=$(mktemp)
        if ! run_go_tui_tests "$path" "$test_type" "$FILTER_ARGS" "$EXTRA_ARGS" > "$TEST_OUTPUT_FILE" 2>&1; then
          TEST_STATUS="failed"
          EXIT_CODE=1
        fi
        TEST_OUTPUT=$(cat "$TEST_OUTPUT_FILE")
        rm -f "$TEST_OUTPUT_FILE"
        ;;
      go-package)
        TEST_OUTPUT_FILE=$(mktemp)
        if ! run_go_package_tests "$path" "$test_type" "$FILTER_ARGS" "$EXTRA_ARGS" > "$TEST_OUTPUT_FILE" 2>&1; then
          TEST_STATUS="failed"
          EXIT_CODE=1
        fi
        TEST_OUTPUT=$(cat "$TEST_OUTPUT_FILE")
        rm -f "$TEST_OUTPUT_FILE"
        ;;
      mcp-server)
        TEST_OUTPUT_FILE=$(mktemp)
        if ! run_mcp_server_tests "$path" "$test_type" "$FILTER_ARGS" "$EXTRA_ARGS" > "$TEST_OUTPUT_FILE" 2>&1; then
          TEST_STATUS="failed"
          EXIT_CODE=1
        fi
        TEST_OUTPUT=$(cat "$TEST_OUTPUT_FILE")
        rm -f "$TEST_OUTPUT_FILE"
        ;;
    esac

    output_test_result "$name" "$test_type" "$TEST_STATUS" "$TEST_OUTPUT"
  done
done <<< "$FILTERED_MODULES"

output_end "$EXIT_CODE"
exit $EXIT_CODE
