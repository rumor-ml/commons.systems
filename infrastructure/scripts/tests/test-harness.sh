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

# Print test summary
print_test_summary() {
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
