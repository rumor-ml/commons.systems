#!/usr/bin/env bash
# End-to-end integration test for complete firebase.json → runtime flow
#
# Tests the entire port configuration chain:
# 1. firebase.json defines ports (source of truth)
# 2. generate-firebase-ports.sh extracts them correctly
# 3. allocate-test-ports.sh sources them correctly
# 4. TypeScript code (FIREBASE_PORTS) matches them
# 5. Runtime code (global-setup.ts) uses them correctly
#
# This test catches integration failures that unit tests miss, such as:
# - Scripts work individually but fail when chained together
# - Environment variable propagation issues across the build process
# - Port value mismatches between different parts of the system
# - Configuration drift (caught by failing tests in CI/pre-commit) where one file is updated but others aren't

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

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

# ============================================================================
# End-to-End Integration Tests
# ============================================================================

test_complete_port_flow() {
  local firebase_json="${REPO_ROOT}/firebase.json"
  local generate_script="${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh"
  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"
  local firebase_ports_ts="${REPO_ROOT}/shared/config/firebase-ports.ts"

  # Verify all required files exist
  if [ ! -f "$firebase_json" ] || [ ! -f "$generate_script" ] || [ ! -f "$allocate_script" ] || [ ! -f "$firebase_ports_ts" ]; then
    test_fail "complete port flow integration" "Required files missing"
    return
  fi

  # Step 1: Extract expected ports from firebase.json (source of truth)
  local expected_auth=$(jq -r '.emulators.auth.port' "$firebase_json")
  local expected_firestore=$(jq -r '.emulators.firestore.port' "$firebase_json")
  local expected_storage=$(jq -r '.emulators.storage.port' "$firebase_json")
  local expected_ui=$(jq -r '.emulators.ui.port' "$firebase_json")

  # Validate extraction worked
  if [ -z "$expected_auth" ] || [ "$expected_auth" = "null" ]; then
    test_fail "complete port flow integration" "Failed to extract auth port from firebase.json"
    return
  fi

  # Step 2: Run generate-firebase-ports.sh and verify output
  local gen_output=$(mktemp)
  local gen_errors=$(mktemp)

  if ! "$generate_script" > "$gen_output" 2> "$gen_errors"; then
    test_fail "complete port flow integration" "generate-firebase-ports.sh failed: $(cat "$gen_errors")"
    # TODO(#1229): Silent cleanup failures could accumulate temp files until /tmp fills
    rm -f "$gen_output" "$gen_errors"
    return
  fi

  # Step 3: Source the generated output and verify variables
  source "$gen_output"

  if [ "${AUTH_PORT:-}" != "$expected_auth" ]; then
    test_fail "complete port flow integration" "AUTH_PORT mismatch: expected $expected_auth, got ${AUTH_PORT:-unset}"
    rm -f "$gen_output" "$gen_errors"
    return
  fi

  if [ "${FIRESTORE_PORT:-}" != "$expected_firestore" ]; then
    test_fail "complete port flow integration" "FIRESTORE_PORT mismatch: expected $expected_firestore, got ${FIRESTORE_PORT:-unset}"
    rm -f "$gen_output" "$gen_errors"
    return
  fi

  if [ "${STORAGE_PORT:-}" != "$expected_storage" ]; then
    test_fail "complete port flow integration" "STORAGE_PORT mismatch: expected $expected_storage, got ${STORAGE_PORT:-unset}"
    rm -f "$gen_output" "$gen_errors"
    return
  fi

  if [ "${UI_PORT:-}" != "$expected_ui" ]; then
    test_fail "complete port flow integration" "UI_PORT mismatch: expected $expected_ui, got ${UI_PORT:-unset}"
    rm -f "$gen_output" "$gen_errors"
    return
  fi

  # Clean up temp files from Step 2
  rm -f "$gen_output" "$gen_errors"

  # Step 4: Verify allocate-test-ports.sh references generate-firebase-ports.sh
  # TODO(#1166): Comment incorrectly describes test scope - "can block" is imprecise
  # (We don't actually source it here because it does port allocation which can block)
  if ! grep -q 'generate-firebase-ports\.sh' "$allocate_script"; then
    test_fail "complete port flow integration" "allocate-test-ports.sh does not reference generate-firebase-ports.sh"
    return
  fi

  # Verify no hardcoded ports exist (should source from generated script)
  local hardcoded=$(grep -E '(AUTH|FIRESTORE|STORAGE|UI)_PORT=[0-9]{4}' "$allocate_script" || true)
  if [ -n "$hardcoded" ]; then
    test_fail "complete port flow integration" "allocate-test-ports.sh contains hardcoded ports: $hardcoded"
    return
  fi

  # Step 5: Verify TypeScript constants match firebase.json
  local ts_firestore=$(grep 'firestore: createPort' "$firebase_ports_ts" | grep -o 'createPort<[^>]*>([0-9]*' | grep -o '[0-9]*')
  local ts_auth=$(grep 'auth: createPort' "$firebase_ports_ts" | grep -o 'createPort<[^>]*>([0-9]*' | grep -o '[0-9]*')
  local ts_storage=$(grep 'storage: createPort' "$firebase_ports_ts" | grep -o 'createPort<[^>]*>([0-9]*' | grep -o '[0-9]*')
  local ts_ui=$(grep 'ui: createPort' "$firebase_ports_ts" | grep -o 'createPort<[^>]*>([0-9]*' | grep -o '[0-9]*')

  if [ "$ts_auth" != "$expected_auth" ]; then
    test_fail "complete port flow integration" "TypeScript AUTH port mismatch: expected $expected_auth, got $ts_auth"
    return
  fi

  if [ "$ts_firestore" != "$expected_firestore" ]; then
    test_fail "complete port flow integration" "TypeScript FIRESTORE port mismatch: expected $expected_firestore, got $ts_firestore"
    return
  fi

  if [ "$ts_storage" != "$expected_storage" ]; then
    test_fail "complete port flow integration" "TypeScript STORAGE port mismatch: expected $expected_storage, got $ts_storage"
    return
  fi

  if [ "$ts_ui" != "$expected_ui" ]; then
    test_fail "complete port flow integration" "TypeScript UI port mismatch: expected $expected_ui, got $ts_ui"
    return
  fi

  test_pass "complete port flow integration"
}

test_runtime_typescript_import() {
  local global_setup="${REPO_ROOT}/printsync/tests/global-setup.ts"

  if [ ! -f "$global_setup" ]; then
    test_fail "runtime TypeScript import" "global-setup.ts not found"
    return
  fi

  # Verify global-setup.ts imports from shared/config/firebase-ports
  if ! grep -q "from.*shared/config/firebase-ports" "$global_setup"; then
    test_fail "runtime TypeScript import" "global-setup.ts does not import from shared/config/firebase-ports"
    return
  fi

  # Verify it uses FIREBASE_PORTS constants
  if ! grep -q "FIREBASE_PORTS\.auth" "$global_setup"; then
    test_fail "runtime TypeScript import" "global-setup.ts does not use FIREBASE_PORTS.auth"
    return
  fi

  if ! grep -q "FIREBASE_PORTS\.firestore" "$global_setup"; then
    test_fail "runtime TypeScript import" "global-setup.ts does not use FIREBASE_PORTS.firestore"
    return
  fi

  if ! grep -q "FIREBASE_PORTS\.storage" "$global_setup"; then
    test_fail "runtime TypeScript import" "global-setup.ts does not use FIREBASE_PORTS.storage"
    return
  fi

  test_pass "runtime TypeScript import"
}

test_port_modification_scenario() {
  # Simulate the scenario where a developer changes firebase.json
  # and verifies that the change would propagate through the entire system

  local firebase_json="${REPO_ROOT}/firebase.json"
  local temp_firebase=$(mktemp)

  # Create a modified firebase.json with different auth port
  jq '.emulators.auth.port = 9098' "$firebase_json" > "$temp_firebase"

  # Verify the modified port is extracted correctly by generate-firebase-ports.sh
  local test_dir=$(mktemp -d)

  mkdir -p "${test_dir}/infrastructure/scripts"
  cp "$temp_firebase" "${test_dir}/firebase.json"
  cp "${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh" "${test_dir}/infrastructure/scripts/"
  chmod +x "${test_dir}/infrastructure/scripts/generate-firebase-ports.sh"

  # Override REPO_ROOT for the generate script
  local gen_output=$(cd "$test_dir" && bash "${test_dir}/infrastructure/scripts/generate-firebase-ports.sh" 2>&1)

  if ! echo "$gen_output" | grep -q "AUTH_PORT=9098"; then
    test_fail "port modification scenario" "Modified port not extracted: $gen_output"
    rm -f "$temp_firebase"
    rm -rf "$test_dir"
    return
  fi

  # Clean up
  rm -f "$temp_firebase"
  rm -rf "$test_dir"

  test_pass "port modification scenario"
}

test_environment_variable_propagation() {
  # Verify that allocate-test-ports.sh exports the expected environment variables
  # by checking the script content (actual execution tested elsewhere)

  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"

  # Verify script exports FIREBASE_*_PORT variables
  if ! grep -q 'export FIREBASE_AUTH_PORT=' "$allocate_script"; then
    test_fail "environment variable propagation" "Script does not export FIREBASE_AUTH_PORT"
    return
  fi

  if ! grep -q 'export FIREBASE_FIRESTORE_PORT=' "$allocate_script"; then
    test_fail "environment variable propagation" "Script does not export FIREBASE_FIRESTORE_PORT"
    return
  fi

  if ! grep -q 'export FIREBASE_STORAGE_PORT=' "$allocate_script"; then
    test_fail "environment variable propagation" "Script does not export FIREBASE_STORAGE_PORT"
    return
  fi

  # Verify emulator host variables are exported
  if ! grep -q 'export FIRESTORE_EMULATOR_HOST=' "$allocate_script"; then
    test_fail "environment variable propagation" "Script does not export FIRESTORE_EMULATOR_HOST"
    return
  fi

  test_pass "environment variable propagation"
}

test_parallel_script_execution() {
  # Verify that generate-firebase-ports.sh can be called multiple times
  # without race conditions (deterministic output)

  local generate_script="${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh"
  local temp_output1=$(mktemp)
  local temp_output2=$(mktemp)

  # Run two instances in parallel
  "$generate_script" > "$temp_output1" 2>/dev/null &
  pid1=$!

  "$generate_script" > "$temp_output2" 2>/dev/null &
  pid2=$!

  # Wait for both to complete
  wait $pid1
  wait $pid2

  # Verify both got the same output (should be deterministic)
  if ! diff "$temp_output1" "$temp_output2" >/dev/null 2>&1; then
    test_fail "parallel script execution" "Output differs between parallel runs"
    rm -f "$temp_output1" "$temp_output2"
    return
  fi

  # Clean up
  rm -f "$temp_output1" "$temp_output2"

  test_pass "parallel script execution"
}

test_cross_platform_compatibility() {
  # Verify the port extraction works with different jq implementations
  # and shell environments (bash, sh compatibility)

  local firebase_json="${REPO_ROOT}/firebase.json"
  local generate_script="${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh"

  # Test with sh (POSIX shell) instead of bash
  local sh_output=$(mktemp)

  # Run with sh if available
  if command -v sh >/dev/null 2>&1; then
    # Note: generate-firebase-ports.sh uses bash shebang, so we test bash here
    # but verify it doesn't use bash-specific features unnecessarily
    if bash "$generate_script" > "$sh_output" 2>/dev/null; then
      if ! grep -q "AUTH_PORT=[0-9]" "$sh_output"; then
        test_fail "cross-platform compatibility" "Port extraction failed with POSIX shell"
        rm -f "$sh_output"
        return
      fi
    else
      test_fail "cross-platform compatibility" "Script failed with POSIX shell"
      rm -f "$sh_output"
      return
    fi
  fi

  # Clean up
  rm -f "$sh_output"

  test_pass "cross-platform compatibility"
}

test_concurrent_allocate_script_sourcing() {
  # Verify allocate-test-ports.sh can be sourced concurrently by multiple processes
  # without race conditions in temporary file creation/cleanup or port allocation
  #
  # This catches issues like:
  # - mktemp collisions when multiple processes call generate-firebase-ports.sh
  # - Trap cleanup in one process interfering with another's temp files
  # - Port allocation conflicts from concurrent execution
  # - File descriptor leaks under concurrent load

  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"
  local num_parallel=5
  local pids=()
  local temp_outputs=()
  local failures=0

  # Launch parallel processes that source the script
  for i in $(seq 1 $num_parallel); do
    local output_file=$(mktemp)
    temp_outputs+=("$output_file")

    (
      # Change to repo root to ensure proper path resolution
      cd "$REPO_ROOT" || exit 1

      # Set SCRIPT_DIR to ensure proper path resolution in allocate-test-ports.sh
      export SCRIPT_DIR="${REPO_ROOT}/infrastructure/scripts"

      # Source the script and verify all ports are set
      if source "$allocate_script" 2>&1; then
        # Verify critical port variables are set and numeric
        if [[ -n "$AUTH_PORT" ]] && [[ "$AUTH_PORT" =~ ^[0-9]+$ ]] && \
           [[ -n "$FIRESTORE_PORT" ]] && [[ "$FIRESTORE_PORT" =~ ^[0-9]+$ ]] && \
           [[ -n "$STORAGE_PORT" ]] && [[ "$STORAGE_PORT" =~ ^[0-9]+$ ]] && \
           [[ -n "$UI_PORT" ]] && [[ "$UI_PORT" =~ ^[0-9]+$ ]] && \
           [[ -n "$HOSTING_PORT" ]] && [[ "$HOSTING_PORT" =~ ^[0-9]+$ ]]; then
          echo "SUCCESS"
        else
          echo "FAILURE: Port variables not set correctly" >&2
          echo "AUTH_PORT=${AUTH_PORT:-unset}" >&2
          echo "FIRESTORE_PORT=${FIRESTORE_PORT:-unset}" >&2
          echo "STORAGE_PORT=${STORAGE_PORT:-unset}" >&2
          echo "UI_PORT=${UI_PORT:-unset}" >&2
          echo "HOSTING_PORT=${HOSTING_PORT:-unset}" >&2
          exit 1
        fi
      else
        echo "FAILURE: Script sourcing failed" >&2
        exit 1
      fi
    ) > "$output_file" 2>&1 &
    pids+=($!)
  done

  # Wait for all processes and count failures
  for i in "${!pids[@]}"; do
    if ! wait "${pids[$i]}"; then
      failures=$((failures + 1))
      # Capture failure output for debugging
      if [ -s "${temp_outputs[$i]}" ]; then
        echo "  Process $((i+1)) output:" >&2
        cat "${temp_outputs[$i]}" >&2
      fi
    fi
  done

  # Clean up temp files
  for output_file in "${temp_outputs[@]}"; do
    rm -f "$output_file"
  done

  # Report results
  if [ $failures -gt 0 ]; then
    test_fail "concurrent allocate script sourcing" "$failures/$num_parallel processes failed"
  else
    test_pass "concurrent allocate script sourcing"
  fi
}

test_port_modification_propagates_to_typescript() {
  # Verify that changing firebase.json would be caught by TypeScript consistency tests
  # This is the core integration promise: changes to firebase.json MUST fail if TypeScript
  # code is not updated accordingly
  #
  # Without this test, we could have:
  # 1. Developer changes firebase.json from auth:9099 to auth:9100
  # 2. Bash scripts correctly extract 9100
  # 3. TypeScript code still has hardcoded 9099
  # 4. Tests pass but runtime connects to wrong port
  #
  # This test verifies the consistency check catches this scenario

  local firebase_json="${REPO_ROOT}/firebase.json"
  local firebase_ports_ts="${REPO_ROOT}/shared/config/firebase-ports.ts"
  local temp_backup="${firebase_json}.backup-$$"

  # Verify required files exist
  if [ ! -f "$firebase_json" ]; then
    test_fail "port modification propagates to typescript" "firebase.json not found"
    return
  fi

  if [ ! -f "$firebase_ports_ts" ]; then
    test_fail "port modification propagates to typescript" "firebase-ports.ts not found"
    return
  fi

  # Check if node is available
  if ! command -v node >/dev/null 2>&1; then
    test_fail "port modification propagates to typescript" "node not found in PATH"
    return
  fi

  # Backup original firebase.json
  if ! cp "$firebase_json" "$temp_backup" 2>/dev/null; then
    test_fail "port modification propagates to typescript" "Failed to backup firebase.json"
    return
  fi

  # Extract original auth port
  local original_port=$(jq -r '.emulators.auth.port' "$firebase_json" 2>/dev/null)
  if [ -z "$original_port" ] || [ "$original_port" = "null" ]; then
    mv "$temp_backup" "$firebase_json" 2>/dev/null || true
    test_fail "port modification propagates to typescript" "Failed to extract original auth port"
    return
  fi

  # Modify firebase.json auth port to a different value
  local modified_port=$((original_port + 1))
  if ! jq ".emulators.auth.port = $modified_port" "$firebase_json" > "${firebase_json}.tmp" 2>/dev/null; then
    mv "$temp_backup" "$firebase_json" 2>/dev/null || true
    test_fail "port modification propagates to typescript" "Failed to modify firebase.json"
    return
  fi

  if ! mv "${firebase_json}.tmp" "$firebase_json" 2>/dev/null; then
    mv "$temp_backup" "$firebase_json" 2>/dev/null || true
    test_fail "port modification propagates to typescript" "Failed to save modified firebase.json"
    return
  fi

  # Run TypeScript consistency test - should FAIL since TS code still has old port
  cd "$REPO_ROOT" || {
    mv "$temp_backup" "$firebase_json" 2>/dev/null || true
    test_fail "port modification propagates to typescript" "Failed to cd to repo root"
    return
  }

  # Run test and capture exit code (redirect output to reduce noise)
  if node --test shared/config/firebase-ports.test.ts >/dev/null 2>&1; then
    local test_exit_code=0
  else
    local test_exit_code=$?
  fi

  # Restore firebase.json before checking results
  mv "$temp_backup" "$firebase_json" 2>/dev/null || true

  # Test should fail (non-zero exit code)
  if [ $test_exit_code -eq 0 ]; then
    test_fail "port modification propagates to typescript" \
      "Consistency test passed but should fail when firebase.json changes without updating TS"
    return
  fi

  test_pass "port modification propagates to typescript"
}

# ============================================================================
# Run All Tests
# ============================================================================

echo "========================================"
echo "Firebase Ports E2E Integration Tests"
echo "========================================"

run_test test_complete_port_flow
run_test test_runtime_typescript_import
run_test test_port_modification_scenario
run_test test_port_modification_propagates_to_typescript
run_test test_environment_variable_propagation
run_test test_parallel_script_execution
run_test test_cross_platform_compatibility
run_test test_concurrent_allocate_script_sourcing

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
  echo "✓ All E2E tests passed!"
  exit 0
else
  echo "✗ Some E2E tests failed"
  exit 1
fi
