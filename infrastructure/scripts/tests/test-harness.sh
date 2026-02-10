#!/usr/bin/env bash
# Shared test harness for shell script tests
#
# Provides common test infrastructure including:
# - Test counters and result tracking
# - test_pass/test_fail helper functions
# - run_test wrapper function
# - print_test_summary function
#
# Usage: source "$(dirname "${BASH_SOURCE[0]}")/test-harness.sh"

set -uo pipefail

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Trap to ensure summary is printed even on unexpected exit
cleanup_on_error() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo ""
    echo "========================================"
    echo "Test run terminated unexpectedly!"
    echo "========================================"
    echo "Tests started: $TESTS_RUN"
    echo "Tests passed:  $TESTS_PASSED"
    echo "Tests failed:  $TESTS_FAILED"
    local not_run=$((TESTS_RUN - TESTS_PASSED - TESTS_FAILED))
    if [ $not_run -gt 0 ]; then
      echo "Not run:       $not_run"
    fi
    echo "========================================"
  fi
}
trap cleanup_on_error EXIT

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

  # Check if test function exists
  if ! declare -f "$test_name" > /dev/null 2>&1; then
    test_fail "$test_name" "Test function not defined"
    return 1
  fi

  # Execute test with error handling
  # Capture both exit code and stderr
  local test_output
  test_output=$(mktemp)
  local test_exit=0

  if ! $test_name 2>"$test_output"; then
    test_exit=$?

    # Check if test already called test_pass or test_fail
    # (by checking if TESTS_PASSED + TESTS_FAILED == TESTS_RUN)
    local recorded_results=$((TESTS_PASSED + TESTS_FAILED))

    if [ $recorded_results -lt $TESTS_RUN ]; then
      # Test crashed without recording result
      echo "✗ CRASH: $test_name (exit code $test_exit)"
      if [ -s "$test_output" ]; then
        echo "  Error output:"
        cat "$test_output" | sed 's/^/    /'
      fi
      TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
  fi

  rm -f "$test_output"
  return $test_exit
}

# Print test summary
print_test_summary() {
  # Clear the error trap since we're explicitly exiting
  trap - EXIT

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
}
