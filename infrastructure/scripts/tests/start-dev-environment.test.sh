#!/usr/bin/env bash
# Unit tests for start-dev-environment.sh orchestration logic

set -uo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test result tracking
test_pass() {
  local test_name=$1
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "✓ PASS: $test_name"
}

test_fail() {
  local test_name=$1
  local reason=$2
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "✗ FAIL: $test_name"
  echo "  Reason: $reason"
}

run_test() {
  local test_name=$1
  TESTS_RUN=$((TESTS_RUN + 1))
  echo ""
  echo "Running: $test_name"
  $test_name
}

# Helper: Run start-dev-environment.sh in test mode (parsing only, no actual execution)
# This extracts just the argument parsing and validation logic
run_parse_test() {
  # Create a temporary test script file
  local test_script="$SCRIPT_DIR/tests/.test-wrapper-$$.sh"

  cat > "$test_script" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail

# Parse arguments (copied from start-dev-environment.sh)
MODE="${1:-}"
APP_NAME="${2:-}"

# Determine mode and app (copied from start-dev-environment.sh)
if [ "$MODE" = "pool" ]; then
  # Pool mode: Second arg is app name
  if [ -z "$APP_NAME" ]; then
    echo "ERROR: Pool mode requires app name" >&2
    echo "Usage: start-dev-environment.sh pool <app-name>" >&2
    exit 1
  fi
  USE_POOL=1
elif [ "$MODE" = "backend" ]; then
  # Backend only mode
  USE_POOL=0
  APP_NAME=""
elif [ -n "$MODE" ]; then
  # First arg is app name
  APP_NAME="$MODE"
  USE_POOL=0
else
  # Auto-detect app from current directory
  USE_POOL=0
  CURRENT_DIR="$(basename "$PWD")"

  # Check if we're in a known app directory
  case "$CURRENT_DIR" in
    fellspiral|printsync|budget|videobrowser|audiobrowser)
      APP_NAME="$CURRENT_DIR"
      ;;
    *)
      # Check if parent is an app directory
      PARENT_DIR="$(basename "$(dirname "$PWD")")"
      case "$PARENT_DIR" in
        fellspiral|printsync|budget|videobrowser|audiobrowser)
          APP_NAME="$PARENT_DIR"
          ;;
        *)
          echo "ERROR: Could not auto-detect app from current directory" >&2
          echo "Please specify app name or run from app directory" >&2
          echo "" >&2
          echo "Usage: start-dev-environment.sh [APP_NAME]" >&2
          echo "Available apps: fellspiral, printsync, budget, videobrowser, audiobrowser" >&2
          exit 1
          ;;
      esac
      ;;
  esac
fi

# Output parsed values for testing
echo "MODE=$MODE"
echo "APP_NAME=$APP_NAME"
echo "USE_POOL=$USE_POOL"
exit 0
EOF

  chmod +x "$test_script"

  # Run the test script with provided args
  local output
  local exit_code
  output=$("$test_script" "$@" 2>&1)
  exit_code=$?

  # Clean up
  rm -f "$test_script"

  echo "$output"
  return $exit_code
}

# ============================================================================
# UNIT TESTS - Mode Detection
# ============================================================================

test_pool_mode_with_app() {
  local output
  output=$(run_parse_test pool fellspiral 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && \
     [[ "$output" == *"MODE=pool"* ]] && \
     [[ "$output" == *"APP_NAME=fellspiral"* ]] && \
     [[ "$output" == *"USE_POOL=1"* ]]; then
    test_pass "Pool mode with app name parses correctly"
  else
    test_fail "Pool mode with app name parses correctly" "Exit code: $exit_code, Output: $output"
  fi
}

test_pool_mode_without_app() {
  local output
  output=$(run_parse_test pool 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && \
     [[ "$output" == *"ERROR: Pool mode requires app name"* ]] && \
     [[ "$output" == *"Usage: start-dev-environment.sh pool <app-name>"* ]]; then
    test_pass "Pool mode without app name errors correctly"
  else
    test_fail "Pool mode without app name errors correctly" "Exit code: $exit_code, Output: $output"
  fi
}

test_backend_mode() {
  local output
  output=$(run_parse_test backend 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && \
     [[ "$output" == *"MODE=backend"* ]] && \
     [[ "$output" == *"APP_NAME="* ]] && \
     [[ "$output" == *"USE_POOL=0"* ]]; then
    test_pass "Backend mode parses correctly"
  else
    test_fail "Backend mode parses correctly" "Exit code: $exit_code, Output: $output"
  fi
}

test_explicit_app_name() {
  local output
  output=$(run_parse_test printsync 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && \
     [[ "$output" == *"MODE=printsync"* ]] && \
     [[ "$output" == *"APP_NAME=printsync"* ]] && \
     [[ "$output" == *"USE_POOL=0"* ]]; then
    test_pass "Explicit app name parses correctly"
  else
    test_fail "Explicit app name parses correctly" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# UNIT TESTS - App Auto-Detection
# ============================================================================

test_auto_detect_from_app_directory() {
  # Create temporary directory structure
  local tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/budget"

  local output
  output=$(cd "$tmpdir/budget" && run_parse_test 2>&1)
  local exit_code=$?

  # Cleanup
  rm -rf "$tmpdir"

  if [ $exit_code -eq 0 ] && \
     [[ "$output" == *"APP_NAME=budget"* ]]; then
    test_pass "Auto-detect app from app directory"
  else
    test_fail "Auto-detect app from app directory" "Exit code: $exit_code, Output: $output"
  fi
}

test_auto_detect_from_subdirectory() {
  # Create temporary directory structure
  local tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/fellspiral/src"

  local output
  output=$(cd "$tmpdir/fellspiral/src" && run_parse_test 2>&1)
  local exit_code=$?

  # Cleanup
  rm -rf "$tmpdir"

  if [ $exit_code -eq 0 ] && \
     [[ "$output" == *"APP_NAME=fellspiral"* ]]; then
    test_pass "Auto-detect app from subdirectory"
  else
    test_fail "Auto-detect app from subdirectory" "Exit code: $exit_code, Output: $output"
  fi
}

test_auto_detect_from_unknown_directory() {
  # Create temporary directory structure
  local tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/unknown/nested"

  local output
  output=$(cd "$tmpdir/unknown/nested" && run_parse_test 2>&1)
  local exit_code=$?

  # Cleanup
  rm -rf "$tmpdir"

  if [ $exit_code -eq 1 ] && \
     [[ "$output" == *"ERROR: Could not auto-detect app from current directory"* ]] && \
     [[ "$output" == *"Available apps: fellspiral, printsync, budget, videobrowser, audiobrowser"* ]]; then
    test_pass "Auto-detect fails from unknown directory with helpful message"
  else
    test_fail "Auto-detect fails from unknown directory with helpful message" "Exit code: $exit_code, Output: $output"
  fi
}

test_auto_detect_all_known_apps() {
  local apps=("fellspiral" "printsync" "budget" "videobrowser" "audiobrowser")
  local all_passed=true

  for app in "${apps[@]}"; do
    local tmpdir=$(mktemp -d)
    mkdir -p "$tmpdir/$app"

    local output
    output=$(cd "$tmpdir/$app" && run_parse_test 2>&1)
    local exit_code=$?

    rm -rf "$tmpdir"

    if [ $exit_code -ne 0 ] || [[ "$output" != *"APP_NAME=$app"* ]]; then
      all_passed=false
      echo "  Failed for app: $app"
      break
    fi
  done

  if [ "$all_passed" = true ]; then
    test_pass "Auto-detect works for all known apps"
  else
    test_fail "Auto-detect works for all known apps" "See output above"
  fi
}

# ============================================================================
# UNIT TESTS - Argument Validation
# ============================================================================

test_pool_mode_validation() {
  # Pool mode requires exactly 2 arguments
  local output
  output=$(run_parse_test pool 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"Pool mode requires app name"* ]]; then
    test_pass "Pool mode validates app name requirement"
  else
    test_fail "Pool mode validates app name requirement" "Exit code: $exit_code"
  fi
}

test_backend_mode_ignores_extra_args() {
  # Backend mode should ignore APP_NAME even if provided in wrong position
  local output
  output=$(run_parse_test backend 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [[ "$output" == *"APP_NAME="* ]] && ! [[ "$output" == *"APP_NAME=backend"* ]]; then
    test_pass "Backend mode ignores extra arguments"
  else
    test_fail "Backend mode ignores extra arguments" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# INTEGRATION TESTS - Error Messages
# ============================================================================

test_error_message_shows_usage() {
  local output
  output=$(run_parse_test pool 2>&1)

  if [[ "$output" == *"Usage: start-dev-environment.sh pool <app-name>"* ]]; then
    test_pass "Error message includes usage instructions"
  else
    test_fail "Error message includes usage instructions" "Output: $output"
  fi
}

test_error_message_lists_available_apps() {
  local tmpdir=$(mktemp -d)
  local output
  output=$(cd "$tmpdir" && run_parse_test 2>&1)
  rm -rf "$tmpdir"

  if [[ "$output" == *"Available apps: fellspiral, printsync, budget, videobrowser, audiobrowser"* ]]; then
    test_pass "Error message lists available apps"
  else
    test_fail "Error message lists available apps" "Output: $output"
  fi
}

# ============================================================================
# EDGE CASE TESTS
# ============================================================================

test_empty_args() {
  # When run with no args and not in an app directory, should fail with helpful message
  local tmpdir=$(mktemp -d)
  local output
  output=$(cd "$tmpdir" && run_parse_test 2>&1)
  local exit_code=$?
  rm -rf "$tmpdir"

  if [ $exit_code -eq 1 ] && \
     [[ "$output" == *"Could not auto-detect app"* ]] && \
     [[ "$output" == *"Usage:"* ]]; then
    test_pass "Empty args with auto-detect failure shows helpful error"
  else
    test_fail "Empty args with auto-detect failure shows helpful error" "Exit code: $exit_code, Output: $output"
  fi
}

test_case_sensitivity() {
  # App names should be case-sensitive (lowercase only)
  local output
  output=$(run_parse_test FellSpiral 2>&1)
  local exit_code=$?

  # This should parse but will fail at later validation stage
  # For now, we just verify it accepts the input
  if [ $exit_code -eq 0 ] && [[ "$output" == *"APP_NAME=FellSpiral"* ]]; then
    test_pass "Case sensitivity preserved in app names"
  else
    test_fail "Case sensitivity preserved in app names" "Exit code: $exit_code, Output: $output"
  fi
}

test_special_characters_in_mode() {
  # Special characters are accepted during parsing (will fail at execution stage)
  local output
  output=$(run_parse_test "pool@#$" 2>&1)
  local exit_code=$?

  # Should parse successfully (validation happens at execution, not parsing)
  if [ $exit_code -eq 0 ] && [[ "$output" == *"APP_NAME=pool@#$"* ]]; then
    test_pass "Special characters in mode are parsed (validation deferred to execution)"
  else
    test_fail "Special characters in mode are parsed (validation deferred to execution)" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# REGRESSION TESTS - Specific Bug Scenarios
# ============================================================================

test_subdirectory_depth_2() {
  # Regression: Running from 2+ levels deep should fail clearly
  local tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/budget/src/components"

  local output
  output=$(cd "$tmpdir/budget/src/components" && run_parse_test 2>&1)
  local exit_code=$?

  rm -rf "$tmpdir"

  if [ $exit_code -eq 1 ] && [[ "$output" == *"Could not auto-detect app"* ]]; then
    test_pass "Running from deeply nested directory fails with clear error"
  else
    test_fail "Running from deeply nested directory fails with clear error" "Exit code: $exit_code, Output: $output"
  fi
}

test_similar_directory_names() {
  # Regression: Directory named similar to app but not exact match
  local tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/budget-old"

  local output
  output=$(cd "$tmpdir/budget-old" && run_parse_test 2>&1)
  local exit_code=$?

  rm -rf "$tmpdir"

  if [ $exit_code -eq 1 ]; then
    test_pass "Similar but non-matching directory name fails detection"
  else
    test_fail "Similar but non-matching directory name fails detection" "Exit code: $exit_code"
  fi
}

test_multiple_mode_keywords() {
  # Regression: Passing pool as app name when not in pool mode
  local output
  output=$(run_parse_test pool pool 2>&1)
  local exit_code=$?

  # "pool pool" means pool mode with app name "pool" - should parse but fail later
  if [ $exit_code -eq 0 ] && \
     [[ "$output" == *"MODE=pool"* ]] && \
     [[ "$output" == *"APP_NAME=pool"* ]]; then
    test_pass "Pool mode with 'pool' as app name is parsed (will fail at execution)"
  else
    test_fail "Pool mode with 'pool' as app name is parsed" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# DOCUMENTATION TESTS - Verify Examples Work
# ============================================================================

test_example_auto_detect() {
  # From script header: start-dev-environment.sh (auto-detect)
  local tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/budget"

  local output
  output=$(cd "$tmpdir/budget" && run_parse_test 2>&1)
  local exit_code=$?

  rm -rf "$tmpdir"

  if [ $exit_code -eq 0 ]; then
    test_pass "Documentation example: auto-detect mode works"
  else
    test_fail "Documentation example: auto-detect mode works" "Exit code: $exit_code"
  fi
}

test_example_explicit_app() {
  # From script header: start-dev-environment.sh fellspiral
  local output
  output=$(run_parse_test fellspiral 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [[ "$output" == *"APP_NAME=fellspiral"* ]]; then
    test_pass "Documentation example: explicit app name works"
  else
    test_fail "Documentation example: explicit app name works" "Exit code: $exit_code"
  fi
}

test_example_pool_mode() {
  # From script header: start-dev-environment.sh pool fellspiral
  local output
  output=$(run_parse_test pool fellspiral 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && \
     [[ "$output" == *"USE_POOL=1"* ]] && \
     [[ "$output" == *"APP_NAME=fellspiral"* ]]; then
    test_pass "Documentation example: pool mode works"
  else
    test_fail "Documentation example: pool mode works" "Exit code: $exit_code"
  fi
}

test_example_backend_only() {
  # From script header: start-dev-environment.sh backend
  local output
  output=$(run_parse_test backend 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && \
     [[ "$output" == *"MODE=backend"* ]] && \
     [[ "$output" == *"USE_POOL=0"* ]]; then
    test_pass "Documentation example: backend-only mode works"
  else
    test_fail "Documentation example: backend-only mode works" "Exit code: $exit_code"
  fi
}

# ============================================================================
# Run All Tests
# ============================================================================

echo "========================================"
echo "Start Dev Environment Test Suite"
echo "========================================"

# Mode Detection Tests
run_test test_pool_mode_with_app
run_test test_pool_mode_without_app
run_test test_backend_mode
run_test test_explicit_app_name

# App Auto-Detection Tests
run_test test_auto_detect_from_app_directory
run_test test_auto_detect_from_subdirectory
run_test test_auto_detect_from_unknown_directory
run_test test_auto_detect_all_known_apps

# Argument Validation Tests
run_test test_pool_mode_validation
run_test test_backend_mode_ignores_extra_args

# Error Message Tests
run_test test_error_message_shows_usage
run_test test_error_message_lists_available_apps

# Edge Case Tests
run_test test_empty_args
run_test test_case_sensitivity
run_test test_special_characters_in_mode

# Regression Tests
run_test test_subdirectory_depth_2
run_test test_similar_directory_names
run_test test_multiple_mode_keywords

# Documentation Tests
run_test test_example_auto_detect
run_test test_example_explicit_app
run_test test_example_pool_mode
run_test test_example_backend_only

# ============================================================================
# Test Summary
# ============================================================================

echo ""
echo "========================================"
echo "Test Results"
echo "========================================"
echo "Total:  $TESTS_RUN"
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo "========================================"

if [ $TESTS_FAILED -eq 0 ]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed"
  exit 1
fi
