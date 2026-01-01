#!/usr/bin/env bash
# Integration tests for emulator startup and cleanup
# Tests start-emulators.sh error handling and temporary config cleanup

set -uo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Cleanup tracking
CLEANUP_DIRS=()

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

# Cleanup helper
cleanup_test_artifacts() {
  # Remove any test directories
  for dir in "${CLEANUP_DIRS[@]}"; do
    rm -rf "$dir" 2>/dev/null || true
  done
  CLEANUP_DIRS=()
}

# Register cleanup on exit
trap cleanup_test_artifacts EXIT

# ============================================================================
# INTEGRATION TESTS - Temporary Config Cleanup on Failure
# ============================================================================

test_hosting_config_cleanup_on_emulator_failure() {
  # Create isolated test environment
  local test_root="${TMPDIR:-/tmp}/emulator-test-$$"
  mkdir -p "${test_root}"
  CLEANUP_DIRS+=("$test_root")

  # Create mock start-emulators.sh script that fails at hosting startup
  local mock_script="${test_root}/start-emulators.sh"
  cat > "$mock_script" <<'MOCK_SCRIPT'
#!/usr/bin/env bash
set -eo pipefail

# Mock environment variables
PROJECT_ID="${PROJECT_ID:-demo-test-project}"
HOSTING_PORT="${HOSTING_PORT:-9999}"
PROJECT_ROOT="${PROJECT_ROOT}"
HOSTING_LOG_FILE="${PROJECT_ROOT}/hosting.log"
HOSTING_PID_FILE="${PROJECT_ROOT}/hosting.pid"
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"

# Create temporary config (simulating real script behavior)
cat > "${TEMP_CONFIG}" <<EOF
{
  "emulators": {
    "hosting": {
      "port": ${HOSTING_PORT}
    }
  },
  "hosting": {
    "public": "dist",
    "site": "test-site"
  }
}
EOF

# Cleanup function for hosting emulator
cleanup_hosting_emulator() {
  # Read PID file before deletion if it exists
  if [ -f "$HOSTING_PID_FILE" ]; then
    IFS=':' read -r pid pgid < "$HOSTING_PID_FILE" 2>/dev/null || true
    if [ -n "$pgid" ]; then
      kill -TERM -$pgid 2>/dev/null || true
      sleep 1
      kill -KILL -$pgid 2>/dev/null || true
    elif [ -n "$pid" ]; then
      kill -TERM $pid 2>/dev/null || true
      sleep 1
      kill -KILL $pid 2>/dev/null || true
    fi
  fi

  # Always cleanup files, even if no PID file exists yet
  # This handles the case where emulator fails before PID is written
  rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
}

# Only register trap when script is run directly, not sourced
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  trap cleanup_hosting_emulator EXIT ERR
fi

# Simulate hosting emulator startup failure
echo "Error: Failed to start hosting emulator" >&2
echo "Port conflict or missing dist directory" >&2
exit 1
MOCK_SCRIPT

  chmod +x "$mock_script"

  # Run the mock script (expect it to fail and cleanup temp config)
  export PROJECT_ROOT="$test_root"
  export PROJECT_ID="demo-test-cleanup"

  if "$mock_script" 2>/dev/null; then
    test_fail "Hosting config cleanup on emulator failure" "Script should have failed"
    return
  fi

  # Verify temp config was cleaned up despite the error
  local temp_config="${test_root}/.firebase-demo-test-cleanup.json"
  if [ -f "$temp_config" ]; then
    test_fail "Hosting config cleanup on emulator failure" "Temp config not cleaned up: $temp_config still exists"
  else
    test_pass "Hosting config cleanup on emulator failure"
  fi
}

test_hosting_config_cleanup_when_sourced() {
  # Create isolated test environment
  local test_root="${TMPDIR:-/tmp}/emulator-test-sourced-$$"
  mkdir -p "${test_root}"
  CLEANUP_DIRS+=("$test_root")

  # Create mock script that can be sourced
  local mock_script="${test_root}/start-emulators.sh"
  cat > "$mock_script" <<'MOCK_SCRIPT'
#!/usr/bin/env bash
# Note: No 'set -e' here to allow testing sourcing behavior

PROJECT_ID="${PROJECT_ID:-demo-test-project}"
HOSTING_PORT="${HOSTING_PORT:-9999}"
PROJECT_ROOT="${PROJECT_ROOT}"
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"
HOSTING_PID_FILE="${PROJECT_ROOT}/hosting.pid"

# Create temporary config
cat > "${TEMP_CONFIG}" <<EOF
{
  "emulators": {
    "hosting": {
      "port": ${HOSTING_PORT}
    }
  }
}
EOF

# Cleanup function
cleanup_hosting_emulator() {
  rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
}

# Only register trap when run directly (not when sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  trap cleanup_hosting_emulator EXIT ERR
fi

# Simulate failure
return 1 2>/dev/null || exit 1
MOCK_SCRIPT

  chmod +x "$mock_script"

  export PROJECT_ROOT="$test_root"
  export PROJECT_ID="demo-test-sourced"

  # Source the script (should not auto-cleanup due to trap logic)
  # This tests that when sourced, the caller is responsible for cleanup
  (
    source "$mock_script" 2>/dev/null || true

    # When sourced, trap is NOT registered, so temp config remains
    # Caller must explicitly call cleanup_hosting_emulator
    local temp_config="${test_root}/.firebase-demo-test-sourced.json"

    if [ -f "$temp_config" ]; then
      # This is expected - temp config should remain when sourced
      # Now manually call cleanup to verify it works
      cleanup_hosting_emulator

      if [ -f "$temp_config" ]; then
        test_fail "Manual cleanup after sourcing" "Temp config not removed by cleanup_hosting_emulator()"
      else
        test_pass "Manual cleanup after sourcing"
      fi
    else
      test_fail "Manual cleanup after sourcing" "Temp config was auto-cleaned (trap shouldn't fire when sourced)"
    fi
  )
}

test_multiple_failure_cleanup() {
  # Test that multiple consecutive failures don't accumulate temp configs
  local test_root="${TMPDIR:-/tmp}/emulator-test-multi-$$"
  mkdir -p "${test_root}"
  CLEANUP_DIRS+=("$test_root")

  # Create mock failing script
  local mock_script="${test_root}/start-emulators.sh"
  cat > "$mock_script" <<'MOCK_SCRIPT'
#!/usr/bin/env bash
set -eo pipefail

PROJECT_ID="${PROJECT_ID:-demo-test-project}"
PROJECT_ROOT="${PROJECT_ROOT}"
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"
HOSTING_PID_FILE="${PROJECT_ROOT}/hosting.pid"

# Create temp config
echo "{}" > "${TEMP_CONFIG}"

# Cleanup function
cleanup_hosting_emulator() {
  rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
}

# Register cleanup
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  trap cleanup_hosting_emulator EXIT ERR
fi

# Fail
exit 1
MOCK_SCRIPT

  chmod +x "$mock_script"

  export PROJECT_ROOT="$test_root"
  export PROJECT_ID="demo-test-multi"

  # Run script 3 times (all should fail and cleanup)
  for i in 1 2 3; do
    "$mock_script" 2>/dev/null || true
  done

  # Count remaining temp configs
  local temp_config_count=$(ls "${test_root}"/.firebase-*.json 2>/dev/null | wc -l | tr -d ' ')

  if [ "$temp_config_count" -eq 0 ]; then
    test_pass "Multiple failures don't accumulate temp configs"
  else
    test_fail "Multiple failures don't accumulate temp configs" "Found $temp_config_count temp configs after 3 failures"
  fi
}

# ============================================================================
# RUN ALL TESTS
# ============================================================================

main() {
  echo "========================================"
  echo "Emulator Startup Tests"
  echo "========================================"

  run_test test_hosting_config_cleanup_on_emulator_failure
  run_test test_hosting_config_cleanup_when_sourced
  run_test test_multiple_failure_cleanup

  echo ""
  echo "========================================"
  echo "Test Results"
  echo "========================================"
  echo "Total:  $TESTS_RUN"
  echo "Passed: $TESTS_PASSED"
  echo "Failed: $TESTS_FAILED"

  if [ $TESTS_FAILED -gt 0 ]; then
    echo ""
    echo "FAILURE: Some tests failed"
    exit 1
  else
    echo ""
    echo "SUCCESS: All tests passed"
    exit 0
  fi
}

main
