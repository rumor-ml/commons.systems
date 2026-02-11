#!/usr/bin/env bash
# Integration and unit tests for emulator-pool.sh

set -uo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Use a test-specific pool directory in the user's home
TEST_POOL_DIR="${HOME}/.firebase-emulator-pool-test-$$"
TEST_POOL_CONFIG="${TEST_POOL_DIR}/pool.json"
TEST_POOL_LOCK="${TEST_POOL_DIR}/pool.lock"

# Clean up on exit
cleanup_on_exit() {
  rm -rf "$TEST_POOL_DIR" 2>/dev/null || true
}
trap cleanup_on_exit EXIT

# Create a modified version of the script for testing
create_test_script() {
  local test_script=$(mktemp)

  # Copy the script and modify pool directory paths AND script directory
  sed -e "s|SCRIPT_DIR=\"\$(cd \"\$(dirname \"\${BASH_SOURCE\[0\]}\")\" && pwd)\"|SCRIPT_DIR=\"${SCRIPT_DIR}\"|" \
      -e "s|POOL_DIR=\"\${HOME}/\.firebase-emulator-pool\"|POOL_DIR=\"${TEST_POOL_DIR}\"|" \
    "${SCRIPT_DIR}/emulator-pool.sh" > "$test_script"

  chmod +x "$test_script"
  echo "$test_script"
}

TEST_SCRIPT=$(create_test_script)

# Clean up test script on exit
cleanup_test_script() {
  rm -f "$TEST_SCRIPT" 2>/dev/null || true
}
trap cleanup_test_script EXIT

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

  # Clean up test pool before each test
  rm -rf "$TEST_POOL_DIR" 2>/dev/null || true

  $test_name
}

# Helper to run emulator-pool commands with test script
pool_cmd() {
  bash "$TEST_SCRIPT" "$@"
}

# ============================================================================
# UNIT TESTS - Pool Initialization
# ============================================================================

test_pool_init_creates_valid_config() {
  local output
  output=$(pool_cmd init 3 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [ -f "$TEST_POOL_CONFIG" ]; then
    local size=$(jq -r '.size' "$TEST_POOL_CONFIG")
    local instance_count=$(jq '.instances | length' "$TEST_POOL_CONFIG")

    if [ "$size" -eq 3 ] && [ "$instance_count" -eq 3 ]; then
      test_pass "pool init creates valid config with correct size"
    else
      test_fail "pool init creates valid config with correct size" "size=$size, instance_count=$instance_count"
    fi
  else
    test_fail "pool init creates valid config with correct size" "Exit code: $exit_code, Config exists: $([ -f "$TEST_POOL_CONFIG" ] && echo yes || echo no)"
  fi
}

test_pool_init_instances_have_unique_ports() {
  pool_cmd init 3 >/dev/null 2>&1

  local ports=$(jq -r '.instances[].authPort' "$TEST_POOL_CONFIG" | sort -n)
  local unique_ports=$(echo "$ports" | uniq)

  if [ "$(echo "$ports" | wc -l)" -eq "$(echo "$unique_ports" | wc -l)" ]; then
    test_pass "pool init instances have unique ports"
  else
    test_fail "pool init instances have unique ports" "Duplicate ports found"
  fi
}

test_pool_init_instances_all_available() {
  pool_cmd init 2 >/dev/null 2>&1

  local available_count=$(jq '[.instances[] | select(.status == "available")] | length' "$TEST_POOL_CONFIG")

  if [ "$available_count" -eq 2 ]; then
    test_pass "pool init instances all start as available"
  else
    test_fail "pool init instances all start as available" "Available count: $available_count"
  fi
}

test_pool_init_rejects_invalid_size() {
  local output
  output=$(pool_cmd init 0 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be a positive integer"* ]]; then
    test_pass "pool init rejects zero size"
  else
    test_fail "pool init rejects zero size" "Exit code: $exit_code"
  fi
}

test_pool_init_rejects_negative_size() {
  local output
  output=$(pool_cmd init -5 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ]; then
    test_pass "pool init rejects negative size"
  else
    test_fail "pool init rejects negative size" "Exit code: $exit_code"
  fi
}

test_pool_init_rejects_non_numeric_size() {
  local output
  output=$(pool_cmd init abc 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"must be a positive integer"* ]]; then
    test_pass "pool init rejects non-numeric size"
  else
    test_fail "pool init rejects non-numeric size" "Exit code: $exit_code"
  fi
}

# ============================================================================
# UNIT TESTS - Claim Instance
# ============================================================================

test_claim_marks_instance_as_in_use() {
  pool_cmd init 2 >/dev/null 2>&1

  local claim_output
  claim_output=$(pool_cmd claim 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    local claimed_count=$(jq '[.instances[] | select(.status == "claimed")] | length' "$TEST_POOL_CONFIG")
    local available_count=$(jq '[.instances[] | select(.status == "available")] | length' "$TEST_POOL_CONFIG")

    if [ "$claimed_count" -eq 1 ] && [ "$available_count" -eq 1 ]; then
      test_pass "claim marks instance as in use"
    else
      test_fail "claim marks instance as in use" "claimed=$claimed_count, available=$available_count"
    fi
  else
    test_fail "claim marks instance as in use" "Exit code: $exit_code"
  fi
}

test_claim_returns_instance_json() {
  pool_cmd init 1 >/dev/null 2>&1

  local claim_output
  claim_output=$(pool_cmd claim 2>&1)

  local instance_id=$(echo "$claim_output" | jq -r '.id' 2>/dev/null)
  local auth_port=$(echo "$claim_output" | jq -r '.authPort' 2>/dev/null)

  if [ -n "$instance_id" ] && [ "$instance_id" != "null" ] && [ -n "$auth_port" ] && [ "$auth_port" != "null" ]; then
    test_pass "claim returns instance JSON"
  else
    test_fail "claim returns instance JSON" "instance_id=$instance_id, auth_port=$auth_port"
  fi
}

test_claim_when_pool_exhausted_returns_error() {
  pool_cmd init 1 >/dev/null 2>&1
  pool_cmd claim >/dev/null 2>&1

  local output
  output=$(pool_cmd claim 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"No available instances"* ]]; then
    test_pass "claim when pool exhausted returns error"
  else
    test_fail "claim when pool exhausted returns error" "Exit code: $exit_code"
  fi
}

test_claim_without_init_returns_error() {
  local output
  output=$(pool_cmd claim 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"Pool not initialized"* ]]; then
    test_pass "claim without init returns error"
  else
    test_fail "claim without init returns error" "Exit code: $exit_code"
  fi
}

# ============================================================================
# UNIT TESTS - Release Instance
# ============================================================================

test_release_returns_instance_to_pool() {
  pool_cmd init 2 >/dev/null 2>&1

  local claim_output
  claim_output=$(pool_cmd claim 2>&1)
  local instance_id=$(echo "$claim_output" | jq -r '.id')

  local output
  output=$(pool_cmd release "$instance_id" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    local available_count=$(jq '[.instances[] | select(.status == "available")] | length' "$TEST_POOL_CONFIG")

    if [ "$available_count" -eq 2 ]; then
      test_pass "release returns instance to pool"
    else
      test_fail "release returns instance to pool" "Available count: $available_count"
    fi
  else
    test_fail "release returns instance to pool" "Exit code: $exit_code"
  fi
}

test_release_clears_claim_metadata() {
  pool_cmd init 1 >/dev/null 2>&1
  local claim_output
  claim_output=$(pool_cmd claim 2>&1)
  local instance_id=$(echo "$claim_output" | jq -r '.id')

  pool_cmd release "$instance_id" >/dev/null 2>&1

  local claimed_by=$(jq -r ".instances[] | select(.id == \"$instance_id\") | .claimedBy" "$TEST_POOL_CONFIG")
  local claimed_at=$(jq -r ".instances[] | select(.id == \"$instance_id\") | .claimedAt" "$TEST_POOL_CONFIG")

  if [ "$claimed_by" = "null" ] && [ "$claimed_at" = "null" ]; then
    test_pass "release clears claim metadata"
  else
    test_fail "release clears claim metadata" "claimedBy=$claimed_by, claimedAt=$claimed_at"
  fi
}

test_release_without_init_returns_error() {
  local output
  output=$(pool_cmd release pool-instance-0 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 1 ] && [[ "$output" == *"Pool not initialized"* ]]; then
    test_pass "release without init returns error"
  else
    test_fail "release without init returns error" "Exit code: $exit_code"
  fi
}

# ============================================================================
# UNIT TESTS - Pool Status
# ============================================================================

test_status_shows_pool_summary() {
  pool_cmd init 3 >/dev/null 2>&1
  pool_cmd claim >/dev/null 2>&1

  local output
  output=$(pool_cmd status 2>&1)

  if [[ "$output" == *"Total instances: 3"* ]] && [[ "$output" == *"Available: 2"* ]] && [[ "$output" == *"Claimed: 1"* ]]; then
    test_pass "status shows pool summary"
  else
    test_fail "status shows pool summary" "Missing expected output"
  fi
}

test_status_without_init_shows_message() {
  local output
  output=$(pool_cmd status 2>&1)

  if [[ "$output" == *"Pool not initialized"* ]]; then
    test_pass "status without init shows message"
  else
    test_fail "status without init shows message" "Output: $output"
  fi
}

# ============================================================================
# UNIT TESTS - Pool Cleanup
# ============================================================================

test_cleanup_removes_pool_config() {
  pool_cmd init 2 >/dev/null 2>&1

  [ -f "$TEST_POOL_CONFIG" ] || { test_fail "cleanup removes pool config" "Config doesn't exist before cleanup"; return; }

  pool_cmd cleanup >/dev/null 2>&1

  if [ ! -f "$TEST_POOL_CONFIG" ]; then
    test_pass "cleanup removes pool config"
  else
    test_fail "cleanup removes pool config" "Config still exists"
  fi
}

test_cleanup_without_init_succeeds() {
  local output
  output=$(pool_cmd cleanup 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [[ "$output" == *"Nothing to clean up"* ]]; then
    test_pass "cleanup without init succeeds"
  else
    test_fail "cleanup without init succeeds" "Exit code: $exit_code"
  fi
}

# ============================================================================
# INTEGRATION TESTS - Concurrent Claims
# ============================================================================

test_concurrent_claims_no_collision() {
  pool_cmd init 3 >/dev/null 2>&1

  local claim1_output=$(mktemp)
  local claim2_output=$(mktemp)
  local claim3_output=$(mktemp)

  pool_cmd claim > "$claim1_output" 2>&1 &
  local pid1=$!

  pool_cmd claim > "$claim2_output" 2>&1 &
  local pid2=$!

  pool_cmd claim > "$claim3_output" 2>&1 &
  local pid3=$!

  wait $pid1
  wait $pid2
  wait $pid3

  local id1=$(jq -r '.id' "$claim1_output" 2>/dev/null || echo "")
  local id2=$(jq -r '.id' "$claim2_output" 2>/dev/null || echo "")
  local id3=$(jq -r '.id' "$claim3_output" 2>/dev/null || echo "")

  rm -f "$claim1_output" "$claim2_output" "$claim3_output"

  if [ "$id1" != "$id2" ] && [ "$id1" != "$id3" ] && [ "$id2" != "$id3" ] && [ -n "$id1" ] && [ -n "$id2" ] && [ -n "$id3" ]; then
    test_pass "concurrent claims no collision"
  else
    test_fail "concurrent claims no collision" "id1=$id1, id2=$id2, id3=$id3"
  fi
}

test_lock_acquisition_timeout() {
  pool_cmd init 1 >/dev/null 2>&1

  mkdir -p "$TEST_POOL_LOCK"
  echo "9999999" > "${TEST_POOL_LOCK}/pid"

  # Use bash with TEST_SCRIPT directly since timeout doesn't have access to pool_cmd function
  timeout 2 bash "$TEST_SCRIPT" claim 2>&1 || local exit_code=$?

  rm -rf "$TEST_POOL_LOCK"

  if [ "${exit_code:-0}" -eq 124 ]; then
    test_pass "lock acquisition has timeout mechanism"
  else
    test_fail "lock acquisition has timeout mechanism" "Exit code: ${exit_code:-0} (expected 124)"
  fi
}

# ============================================================================
# INTEGRATION TESTS - Claim/Release Lifecycle
# ============================================================================

test_full_claim_release_lifecycle() {
  pool_cmd init 2 >/dev/null 2>&1

  local available_before=$(jq '[.instances[] | select(.status == "available")] | length' "$TEST_POOL_CONFIG")

  local claim_output
  claim_output=$(pool_cmd claim 2>&1)
  local instance_id=$(echo "$claim_output" | jq -r '.id')

  local available_claimed=$(jq '[.instances[] | select(.status == "available")] | length' "$TEST_POOL_CONFIG")

  pool_cmd release "$instance_id" >/dev/null 2>&1

  local available_after=$(jq '[.instances[] | select(.status == "available")] | length' "$TEST_POOL_CONFIG")

  if [ "$available_before" -eq 2 ] && [ "$available_claimed" -eq 1 ] && [ "$available_after" -eq 2 ]; then
    test_pass "full claim/release lifecycle"
  else
    test_fail "full claim/release lifecycle" "before=$available_before, claimed=$available_claimed, after=$available_after"
  fi
}

test_multiple_claim_release_cycles() {
  pool_cmd init 1 >/dev/null 2>&1

  for i in 1 2 3; do
    local claim_output
    claim_output=$(pool_cmd claim 2>&1)
    local instance_id=$(echo "$claim_output" | jq -r '.id')
    pool_cmd release "$instance_id" >/dev/null 2>&1
  done

  local available=$(jq '[.instances[] | select(.status == "available")] | length' "$TEST_POOL_CONFIG")

  if [ "$available" -eq 1 ]; then
    test_pass "multiple claim/release cycles"
  else
    test_fail "multiple claim/release cycles" "Available count: $available"
  fi
}

# ============================================================================
# REGRESSION TESTS - Specific Failure Scenarios
# ============================================================================

test_regression_simultaneous_port_allocation() {
  pool_cmd init 1 >/dev/null 2>&1

  local claim1=$(mktemp)
  local claim2=$(mktemp)

  pool_cmd claim > "$claim1" 2>&1 &
  local pid1=$!

  pool_cmd claim > "$claim2" 2>&1 &
  local pid2=$!

  wait $pid1
  local exit1=$?
  wait $pid2
  local exit2=$?

  local success_count=0
  [ $exit1 -eq 0 ] && success_count=$((success_count + 1))
  [ $exit2 -eq 0 ] && success_count=$((success_count + 1))

  rm -f "$claim1" "$claim2"

  if [ "$success_count" -eq 1 ]; then
    test_pass "regression: simultaneous claims don't allocate same ports"
  else
    test_fail "regression: simultaneous claims don't allocate same ports" "success_count=$success_count"
  fi
}

test_regression_release_failure_leaks_instance() {
  pool_cmd init 1 >/dev/null 2>&1
  local claim_output
  claim_output=$(pool_cmd claim 2>&1)
  local instance_id=$(echo "$claim_output" | jq -r '.id')

  local claimed_before=$(jq '[.instances[] | select(.status == "claimed")] | length' "$TEST_POOL_CONFIG")

  pool_cmd release "$instance_id" >/dev/null 2>&1

  local available_after=$(jq '[.instances[] | select(.status == "available")] | length' "$TEST_POOL_CONFIG")

  pool_cmd claim >/dev/null 2>&1
  local reclaim_exit=$?

  if [ "$claimed_before" -eq 1 ] && [ "$available_after" -eq 1 ] && [ "$reclaim_exit" -eq 0 ]; then
    test_pass "regression: release doesn't leak instances"
  else
    test_fail "regression: release doesn't leak instances" "claimed=$claimed_before, available=$available_after, reclaim_exit=$reclaim_exit"
  fi
}

# ============================================================================
# Run All Tests
# ============================================================================

echo "========================================"
echo "Emulator Pool Test Suite"
echo "========================================"

# Pool Initialization Tests
run_test test_pool_init_creates_valid_config
run_test test_pool_init_instances_have_unique_ports
run_test test_pool_init_instances_all_available
run_test test_pool_init_rejects_invalid_size
run_test test_pool_init_rejects_negative_size
run_test test_pool_init_rejects_non_numeric_size

# Claim Instance Tests
run_test test_claim_marks_instance_as_in_use
run_test test_claim_returns_instance_json
run_test test_claim_when_pool_exhausted_returns_error
run_test test_claim_without_init_returns_error

# Release Instance Tests
run_test test_release_returns_instance_to_pool
run_test test_release_clears_claim_metadata
run_test test_release_without_init_returns_error

# Pool Status Tests
run_test test_status_shows_pool_summary
run_test test_status_without_init_shows_message

# Pool Cleanup Tests
run_test test_cleanup_removes_pool_config
run_test test_cleanup_without_init_succeeds

# Concurrent Claims Tests
run_test test_concurrent_claims_no_collision
run_test test_lock_acquisition_timeout

# Lifecycle Tests
run_test test_full_claim_release_lifecycle
run_test test_multiple_claim_release_cycles

# Regression Tests
run_test test_regression_simultaneous_port_allocation
run_test test_regression_release_failure_leaks_instance

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
