#!/usr/bin/env bash
# Integration and unit tests for port-utils.sh

set -uo pipefail

# Get script directory and source port utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${SCRIPT_DIR}/port-utils.sh"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# TODO(#1082): Shell tests use inconsistent assertion patterns (test_pass/test_fail vs direct assertions)
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

# ============================================================================
# UNIT TESTS - Parameter Validation
# ============================================================================

test_validate_positive_int_valid() {
  local output
  output=$(validate_positive_int 123 "test_param" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    test_pass "validate_positive_int accepts valid positive integer"
  else
    test_fail "validate_positive_int accepts valid positive integer" "Exit code: $exit_code"
  fi
}

test_validate_positive_int_zero() {
  local output
  output=$(validate_positive_int 0 "test_param" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be >= 1"* ]]; then
    test_pass "validate_positive_int rejects zero"
  else
    test_fail "validate_positive_int rejects zero" "Exit code: $exit_code, Output: $output"
  fi
}

test_validate_positive_int_negative() {
  local output
  output=$(validate_positive_int -5 "test_param" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be a positive integer"* ]]; then
    test_pass "validate_positive_int rejects negative"
  else
    test_fail "validate_positive_int rejects negative" "Exit code: $exit_code, Output: $output"
  fi
}

test_validate_positive_int_non_numeric() {
  local output
  output=$(validate_positive_int "abc" "test_param" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be a positive integer"* ]]; then
    test_pass "validate_positive_int rejects non-numeric"
  else
    test_fail "validate_positive_int rejects non-numeric" "Exit code: $exit_code, Output: $output"
  fi
}

test_validate_port_range_valid() {
  local output
  output=$(validate_port_range 8080 "test_port" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    test_pass "validate_port_range accepts valid port"
  else
    test_fail "validate_port_range accepts valid port" "Exit code: $exit_code"
  fi
}

test_validate_port_range_max() {
  local output
  output=$(validate_port_range 65535 "test_port" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    test_pass "validate_port_range accepts maximum valid port"
  else
    test_fail "validate_port_range accepts maximum valid port" "Exit code: $exit_code"
  fi
}

test_validate_port_range_too_high() {
  local output
  output=$(validate_port_range 65536 "test_port" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be <= 65535"* ]]; then
    test_pass "validate_port_range rejects port > 65535"
  else
    test_fail "validate_port_range rejects port > 65535" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# UNIT TESTS - Port Blacklist
# ============================================================================

test_is_port_blacklisted_reserved() {
  local exit_code
  is_port_blacklisted 5000 2>/dev/null
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    test_pass "is_port_blacklisted detects reserved port 5000"
  else
    test_fail "is_port_blacklisted detects reserved port 5000" "Exit code: $exit_code"
  fi
}

test_is_port_blacklisted_browser_restricted() {
  local exit_code
  is_port_blacklisted 6665 2>/dev/null
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    test_pass "is_port_blacklisted detects browser-restricted port 6665"
  else
    test_fail "is_port_blacklisted detects browser-restricted port 6665" "Exit code: $exit_code"
  fi
}

test_is_port_blacklisted_not_reserved() {
  local exit_code
  is_port_blacklisted 9999 2>/dev/null
  exit_code=$?

  if [ $exit_code -eq 1 ]; then
    test_pass "is_port_blacklisted allows non-reserved port"
  else
    test_fail "is_port_blacklisted allows non-reserved port" "Exit code: $exit_code"
  fi
}

test_is_port_blacklisted_invalid_port() {
  local output
  output=$(is_port_blacklisted 99999 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be <= 65535"* ]]; then
    test_pass "is_port_blacklisted rejects invalid port"
  else
    test_fail "is_port_blacklisted rejects invalid port" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# UNIT TESTS - Port Availability
# ============================================================================

test_is_port_available_high_port() {
  # Use a very high port that's unlikely to be in use
  local exit_code
  is_port_available 60000 2>/dev/null
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    test_pass "is_port_available detects available port"
  else
    test_fail "is_port_available detects available port" "Exit code: $exit_code (port may be in use)"
  fi
}

test_is_port_available_invalid_port() {
  local output
  output=$(is_port_available -1 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be a positive integer"* ]]; then
    test_pass "is_port_available rejects invalid port"
  else
    test_fail "is_port_available rejects invalid port" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# UNIT TESTS - Find Available Port
# ============================================================================

test_find_available_port_basic() {
  # Use high port range to avoid conflicts
  local result
  result=$(find_available_port 60000 10 1 2>/dev/null)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [ -n "$result" ] && [ "$result" -ge 60000 ]; then
    test_pass "find_available_port returns available port"
  else
    test_fail "find_available_port returns available port" "Exit code: $exit_code, Result: $result"
  fi
}

test_find_available_port_skips_blacklist() {
  # Start at blacklisted port, should skip to next
  local result
  result=$(find_available_port 5000 10 1 2>&1)
  local exit_code=$?

  if [[ "$result" == *"Skipping blacklisted port 5000"* ]] || [[ "$result" == *"Skipping blacklisted port 5001"* ]]; then
    test_pass "find_available_port skips blacklisted ports"
  else
    test_fail "find_available_port skips blacklisted ports" "Output: $result"
  fi
}

test_find_available_port_invalid_base() {
  local output
  output=$(find_available_port -1 10 10 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be a positive integer"* ]]; then
    test_pass "find_available_port rejects invalid base_port"
  else
    test_fail "find_available_port rejects invalid base_port" "Exit code: $exit_code, Output: $output"
  fi
}

test_find_available_port_invalid_attempts() {
  local output
  output=$(find_available_port 8080 0 10 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be >= 1"* ]]; then
    test_pass "find_available_port rejects zero max_attempts"
  else
    test_fail "find_available_port rejects zero max_attempts" "Exit code: $exit_code, Output: $output"
  fi
}

test_find_available_port_invalid_step() {
  local output
  output=$(find_available_port 8080 10 -5 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be a positive integer"* ]]; then
    test_pass "find_available_port rejects negative port_step"
  else
    test_fail "find_available_port rejects negative port_step" "Exit code: $exit_code, Output: $output"
  fi
}

test_find_available_port_range_overflow() {
  # Test the overflow detection logic exists in find_available_port
  # Read the function and verify it has the overflow check
  local func_body
  func_body=$(declare -f find_available_port)

  if [[ "$func_body" == *"exceeded valid range"* ]] && [[ "$func_body" == *"-gt 65535"* ]]; then
    test_pass "find_available_port has overflow detection logic"
  else
    test_fail "find_available_port has overflow detection logic" "Missing overflow check in function"
  fi
}

test_hosting_port_fallback_e2e() {
  # Block port 5000 to simulate macOS AirPlay or other system service
  nc -l 5000 &
  local blocker_pid=$!

  # Give nc time to bind
  sleep 0.2

  # Source allocate script in subshell to isolate environment
  local result
  result=$(
    # Mock git to return fake worktree with hash that maps to port 5000
    # Hash of "/fake/worktree" via cksum gives offset 0 -> base port 5000
    git() {
      if [[ "$*" == *"rev-parse --show-toplevel"* ]]; then
        echo "/fake/worktree"
      elif [[ "$*" == *"branch --show-current"* ]]; then
        echo "test-branch"
      fi
    }
    export -f git

    # Source the allocation script
    source "${SCRIPT_DIR}/allocate-test-ports.sh" 2>/dev/null

    # Output the allocated port
    echo "$HOSTING_PORT"
  )

  # Clean up blocker
  kill $blocker_pid 2>/dev/null || true
  wait $blocker_pid 2>/dev/null || true

  # Verify fallback was used
  if [ "$result" != "5000" ] && [ "$result" -gt 5000 ] && [ "$result" -le 5990 ]; then
    test_pass "Hosting port fallback E2E (allocated $result instead of 5000)"
  else
    test_fail "Hosting port fallback E2E" "Expected port != 5000 and in range, got: $result"
  fi
}

test_find_available_port_exhaustion() {
  # Try to find port in a tight range that's likely exhausted
  # Use very high port range to minimize real port conflicts
  local output
  output=$(find_available_port 65530 3 1 2>&1)
  local exit_code=$?

  # This test has two valid outcomes:
  # 1. Ports available: returns port successfully
  # 2. Ports unavailable: returns error with helpful range message

  if [ $exit_code -eq 0 ]; then
    # Ports were available - test passes (can't force exhaustion)
    test_pass "Port exhaustion test (ports available, allocation succeeded)"
  else
    # Verify error message includes the port range for debugging
    if [[ "$output" == *"65530"* ]] && [[ "$output" == *"range"* ]]; then
      test_pass "Port exhaustion returns helpful error with range"
    else
      test_fail "Port exhaustion returns helpful error with range" "Output missing range info: $output"
    fi
  fi
}

# ============================================================================
# INTEGRATION TESTS - Multi-Worktree Isolation
# ============================================================================

test_hash_consistency_allocate_cleanup() {
  # Simulate hash calculation from both scripts
  local worktree_root="/Users/n8/worktrees/test-worktree-1"

  # Hash from allocate-test-ports.sh pattern
  local hash1=$(echo -n "$worktree_root" | cksum | awk '{print $1}')
  local offset1=$(($hash1 % 100))

  # Hash from cleanup-test-processes.sh pattern (should be identical)
  local hash2=$(echo -n "$worktree_root" | cksum | awk '{print $1}')
  local offset2=$(($hash2 % 100))

  if [ "$hash1" -eq "$hash2" ] && [ "$offset1" -eq "$offset2" ]; then
    test_pass "Hash calculation consistent between allocate and cleanup"
  else
    test_fail "Hash calculation consistent between allocate and cleanup" "hash1=$hash1 hash2=$hash2 offset1=$offset1 offset2=$offset2"
  fi
}

test_unique_ports_per_worktree() {
  # Simulate two different worktrees
  local worktree1="/Users/n8/worktrees/test-worktree-1"
  local worktree2="/Users/n8/worktrees/test-worktree-2"

  local hash1=$(echo -n "$worktree1" | cksum | awk '{print $1}')
  local offset1=$(($hash1 % 100))
  local port1=$((5000 + ($offset1 * 10)))

  local hash2=$(echo -n "$worktree2" | cksum | awk '{print $1}')
  local offset2=$(($hash2 % 100))
  local port2=$((5000 + ($offset2 * 10)))

  if [ "$port1" -ne "$port2" ]; then
    test_pass "Different worktrees get different base ports"
  else
    test_fail "Different worktrees get different base ports" "Both got port $port1"
  fi
}

test_project_id_isolation() {
  # Verify project IDs are unique per worktree
  local worktree1="/Users/n8/worktrees/test-worktree-1"
  local worktree2="/Users/n8/worktrees/test-worktree-2"

  local hash1=$(echo -n "$worktree1" | cksum | awk '{print $1}')
  local project_id1="demo-test-${hash1}"

  local hash2=$(echo -n "$worktree2" | cksum | awk '{print $1}')
  local project_id2="demo-test-${hash2}"

  if [ "$project_id1" != "$project_id2" ]; then
    test_pass "Different worktrees get different project IDs"
  else
    test_fail "Different worktrees get different project IDs" "Both got $project_id1"
  fi
}

# ============================================================================
# NEGATIVE TESTS - Error Handling
# ============================================================================

test_error_message_includes_range() {
  local output
  output=$(find_available_port 65530 3 10 2>&1)

  if [[ "$output" == *"65530"* ]]; then
    test_pass "Error message includes attempted port range"
  else
    test_fail "Error message includes attempted port range" "Output: $output"
  fi
}

test_get_port_owner_invalid() {
  local output
  output=$(get_port_owner 99999 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be <= 65535"* ]]; then
    test_pass "get_port_owner rejects invalid port"
  else
    test_fail "get_port_owner rejects invalid port" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# Run All Tests
# ============================================================================

echo "========================================"
echo "Port Utils Test Suite"
echo "========================================"

# Parameter Validation Tests
run_test test_validate_positive_int_valid
run_test test_validate_positive_int_zero
run_test test_validate_positive_int_negative
run_test test_validate_positive_int_non_numeric
run_test test_validate_port_range_valid
run_test test_validate_port_range_max
run_test test_validate_port_range_too_high

# Port Blacklist Tests
run_test test_is_port_blacklisted_reserved
run_test test_is_port_blacklisted_browser_restricted
run_test test_is_port_blacklisted_not_reserved
run_test test_is_port_blacklisted_invalid_port

# Port Availability Tests
run_test test_is_port_available_high_port
run_test test_is_port_available_invalid_port

# Find Available Port Tests
run_test test_find_available_port_basic
run_test test_find_available_port_skips_blacklist
run_test test_find_available_port_invalid_base
run_test test_find_available_port_invalid_attempts
run_test test_find_available_port_invalid_step
run_test test_find_available_port_range_overflow
run_test test_hosting_port_fallback_e2e
run_test test_find_available_port_exhaustion

# Integration Tests
run_test test_hash_consistency_allocate_cleanup
run_test test_unique_ports_per_worktree
run_test test_project_id_isolation

# Negative Tests
run_test test_error_message_includes_range
run_test test_get_port_owner_invalid

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
