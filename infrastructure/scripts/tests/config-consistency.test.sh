#!/usr/bin/env bash
# Configuration consistency tests for Firebase ports
#
# Ensures that hardcoded ports in various configuration files match
# the ports defined in firebase.json (the source of truth).
#
# This prevents configuration drift where developers change firebase.json
# but forget to update related configuration files, causing connection
# failures and confusing "connection refused" errors.
#
# Related files:
# - firebase.json: Source of truth for emulator configuration
# - shared/config/firebase-ports.ts: TypeScript constants exported to apps
# - fellspiral/site/src/scripts/firebase.js: Uses FIREBASE_PORTS for emulator connection
# - infrastructure/scripts/allocate-test-ports.sh: Bash script with port constants

set -euo pipefail

# Get repository root (3 levels up from this script)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

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
# Firebase Port Consistency Tests
# ============================================================================

test_firebase_json_has_emulator_config() {
  local firebase_json="${REPO_ROOT}/firebase.json"

  if [ ! -f "$firebase_json" ]; then
    test_fail "firebase.json exists" "File not found at $firebase_json"
    return
  fi

  # Check if emulators section exists
  if ! jq -e '.emulators' "$firebase_json" >/dev/null 2>&1; then
    test_fail "firebase.json has emulators config" "No .emulators section in firebase.json"
    return
  fi

  test_pass "firebase.json has emulators config"
}

test_firebase_ports_ts_matches_json() {
  local firebase_json="${REPO_ROOT}/firebase.json"
  local firebase_ports_ts="${REPO_ROOT}/shared/config/firebase-ports.ts"

  if [ ! -f "$firebase_json" ] || [ ! -f "$firebase_ports_ts" ]; then
    test_fail "firebase-ports.ts matches firebase.json" "Required files not found"
    return
  fi

  # Extract ports from firebase.json using jq
  local firestore_json=$(jq -r '.emulators.firestore.port' "$firebase_json")
  local auth_json=$(jq -r '.emulators.auth.port' "$firebase_json")
  local storage_json=$(jq -r '.emulators.storage.port' "$firebase_json")
  local ui_json=$(jq -r '.emulators.ui.port' "$firebase_json")

  # Extract ports from firebase-ports.ts using grep and sed
  # Match patterns like: firestore: 8081 as FirestorePort,
  local firestore_ts=$(grep -o 'firestore: [0-9]*' "$firebase_ports_ts" | grep -o '[0-9]*')
  local auth_ts=$(grep -o 'auth: [0-9]*' "$firebase_ports_ts" | grep -o '[0-9]*')
  local storage_ts=$(grep -o 'storage: [0-9]*' "$firebase_ports_ts" | grep -o '[0-9]*')
  local ui_ts=$(grep -o 'ui: [0-9]*' "$firebase_ports_ts" | grep -o '[0-9]*')

  # Compare ports
  local mismatches=""

  if [ "$firestore_json" != "$firestore_ts" ]; then
    mismatches="${mismatches}Firestore: json=$firestore_json, ts=$firestore_ts; "
  fi

  if [ "$auth_json" != "$auth_ts" ]; then
    mismatches="${mismatches}Auth: json=$auth_json, ts=$auth_ts; "
  fi

  if [ "$storage_json" != "$storage_ts" ]; then
    mismatches="${mismatches}Storage: json=$storage_json, ts=$storage_ts; "
  fi

  if [ "$ui_json" != "$ui_ts" ]; then
    mismatches="${mismatches}UI: json=$ui_json, ts=$ui_ts; "
  fi

  if [ -n "$mismatches" ]; then
    test_fail "firebase-ports.ts matches firebase.json" "Port mismatches: $mismatches"
    return
  fi

  test_pass "firebase-ports.ts matches firebase.json"
}

test_firebase_js_imports_from_shared_config() {
  local firebase_js="${REPO_ROOT}/fellspiral/site/src/scripts/firebase.js"

  if [ ! -f "$firebase_js" ]; then
    test_fail "firebase.js imports from shared config" "File not found at $firebase_js"
    return
  fi

  # Check if firebase.js imports from shared/config/firebase-ports.ts
  if ! grep -q "from.*shared/config/firebase-ports" "$firebase_js"; then
    test_fail "firebase.js imports from shared config" "No import from shared/config/firebase-ports.ts found"
    return
  fi

  # Check if it uses FIREBASE_PORTS.firestore and FIREBASE_PORTS.auth
  if ! grep -q "FIREBASE_PORTS\.firestore" "$firebase_js"; then
    test_fail "firebase.js imports from shared config" "No usage of FIREBASE_PORTS.firestore found"
    return
  fi

  if ! grep -q "FIREBASE_PORTS\.auth" "$firebase_js"; then
    test_fail "firebase.js imports from shared config" "No usage of FIREBASE_PORTS.auth found"
    return
  fi

  test_pass "firebase.js imports from shared config"
}

test_no_hardcoded_ports_in_firebase_js() {
  local firebase_js="${REPO_ROOT}/fellspiral/site/src/scripts/firebase.js"

  if [ ! -f "$firebase_js" ]; then
    test_fail "firebase.js has no hardcoded ports" "File not found at $firebase_js"
    return
  fi

  # Check for old hardcoded port patterns (but allow FIREBASE_PORTS usage)
  # Look for patterns like: port = 8081 or port: 8081 (not FIREBASE_PORTS.*)
  local hardcoded_pattern='(firestore|auth)(Port|Host)?\s*=\s*[0-9]{4}'

  if grep -E "$hardcoded_pattern" "$firebase_js" | grep -v "FIREBASE_PORTS" >/dev/null 2>&1; then
    test_fail "firebase.js has no hardcoded ports" "Found hardcoded port assignments not using FIREBASE_PORTS"
    return
  fi

  test_pass "firebase.js has no hardcoded ports"
}

test_allocate_test_ports_matches_json() {
  local firebase_json="${REPO_ROOT}/firebase.json"
  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"

  if [ ! -f "$firebase_json" ] || [ ! -f "$allocate_script" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "Required files not found"
    return
  fi

  # Extract ports from firebase.json using jq
  local firestore_json=$(jq -r '.emulators.firestore.port' "$firebase_json")
  local auth_json=$(jq -r '.emulators.auth.port' "$firebase_json")
  local storage_json=$(jq -r '.emulators.storage.port' "$firebase_json")
  local ui_json=$(jq -r '.emulators.ui.port' "$firebase_json")

  # Source allocate-test-ports.sh to get the ports it loads
  # This validates that the script correctly sources ports from generate-firebase-ports.sh
  # Note: We need to source in a subshell to avoid polluting current shell
  (
    # Unset any existing port variables to ensure clean test
    unset AUTH_PORT FIRESTORE_PORT STORAGE_PORT UI_PORT

    # Source the script (it will load ports via generate-firebase-ports.sh)
    source "$allocate_script" 2>/dev/null

    # Export ports for parent shell to verify
    echo "FIRESTORE_PORT=${FIRESTORE_PORT}"
    echo "AUTH_PORT=${AUTH_PORT}"
    echo "STORAGE_PORT=${STORAGE_PORT}"
    echo "UI_PORT=${UI_PORT}"
  ) > /tmp/allocate_ports_output.txt

  # Read the sourced ports
  local firestore_sh=$(grep '^FIRESTORE_PORT=' /tmp/allocate_ports_output.txt | cut -d= -f2)
  local auth_sh=$(grep '^AUTH_PORT=' /tmp/allocate_ports_output.txt | cut -d= -f2)
  local storage_sh=$(grep '^STORAGE_PORT=' /tmp/allocate_ports_output.txt | cut -d= -f2)
  local ui_sh=$(grep '^UI_PORT=' /tmp/allocate_ports_output.txt | cut -d= -f2)

  # Compare ports
  local mismatches=""

  if [ "$firestore_json" != "$firestore_sh" ]; then
    mismatches="${mismatches}Firestore: json=$firestore_json, sh=$firestore_sh; "
  fi

  if [ "$auth_json" != "$auth_sh" ]; then
    mismatches="${mismatches}Auth: json=$auth_json, sh=$auth_sh; "
  fi

  if [ "$storage_json" != "$storage_sh" ]; then
    mismatches="${mismatches}Storage: json=$storage_json, sh=$storage_sh; "
  fi

  if [ "$ui_json" != "$ui_sh" ]; then
    mismatches="${mismatches}UI: json=$ui_json, sh=$ui_sh; "
  fi

  if [ -n "$mismatches" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "Port mismatches: $mismatches"
    return
  fi

  test_pass "allocate-test-ports.sh matches firebase.json"
}

test_generate_firebase_ports_works() {
  local generate_script="${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh"
  local firebase_json="${REPO_ROOT}/firebase.json"

  if [ ! -f "$generate_script" ] || [ ! -f "$firebase_json" ]; then
    test_fail "generate-firebase-ports.sh works correctly" "Required files not found"
    return
  fi

  # Source the generated ports
  source <("$generate_script")

  # Extract expected ports from firebase.json
  local firestore_json=$(jq -r '.emulators.firestore.port' "$firebase_json")
  local auth_json=$(jq -r '.emulators.auth.port' "$firebase_json")
  local storage_json=$(jq -r '.emulators.storage.port' "$firebase_json")
  local ui_json=$(jq -r '.emulators.ui.port' "$firebase_json")

  # Verify ports were loaded and match firebase.json
  local mismatches=""

  if [ -z "${FIRESTORE_PORT:-}" ]; then
    mismatches="${mismatches}FIRESTORE_PORT not set; "
  elif [ "$firestore_json" != "$FIRESTORE_PORT" ]; then
    mismatches="${mismatches}Firestore: json=$firestore_json, generated=$FIRESTORE_PORT; "
  fi

  if [ -z "${AUTH_PORT:-}" ]; then
    mismatches="${mismatches}AUTH_PORT not set; "
  elif [ "$auth_json" != "$AUTH_PORT" ]; then
    mismatches="${mismatches}Auth: json=$auth_json, generated=$AUTH_PORT; "
  fi

  if [ -z "${STORAGE_PORT:-}" ]; then
    mismatches="${mismatches}STORAGE_PORT not set; "
  elif [ "$storage_json" != "$STORAGE_PORT" ]; then
    mismatches="${mismatches}Storage: json=$storage_json, generated=$STORAGE_PORT; "
  fi

  if [ -z "${UI_PORT:-}" ]; then
    mismatches="${mismatches}UI_PORT not set; "
  elif [ "$ui_json" != "$UI_PORT" ]; then
    mismatches="${mismatches}UI: json=$ui_json, generated=$UI_PORT; "
  fi

  if [ -n "$mismatches" ]; then
    test_fail "generate-firebase-ports.sh works correctly" "Port mismatches or missing variables: $mismatches"
    return
  fi

  test_pass "generate-firebase-ports.sh works correctly"
}

test_printsync_global_setup_uses_firebase_ports() {
  local global_setup="${REPO_ROOT}/printsync/tests/global-setup.ts"

  if [ ! -f "$global_setup" ]; then
    test_fail "printsync global-setup.ts uses FIREBASE_PORTS" "File not found at $global_setup"
    return
  fi

  # Check if it imports FIREBASE_PORTS from shared config
  if ! grep -q "from.*shared/config/firebase-ports" "$global_setup"; then
    test_fail "printsync global-setup.ts uses FIREBASE_PORTS" "No import from shared/config/firebase-ports found"
    return
  fi

  # Check if it uses FIREBASE_PORTS.auth, FIREBASE_PORTS.firestore, FIREBASE_PORTS.storage
  if ! grep -q "FIREBASE_PORTS\.auth" "$global_setup"; then
    test_fail "printsync global-setup.ts uses FIREBASE_PORTS" "No usage of FIREBASE_PORTS.auth found"
    return
  fi

  if ! grep -q "FIREBASE_PORTS\.firestore" "$global_setup"; then
    test_fail "printsync global-setup.ts uses FIREBASE_PORTS" "No usage of FIREBASE_PORTS.firestore found"
    return
  fi

  if ! grep -q "FIREBASE_PORTS\.storage" "$global_setup"; then
    test_fail "printsync global-setup.ts uses FIREBASE_PORTS" "No usage of FIREBASE_PORTS.storage found"
    return
  fi

  # Check that it does NOT have hardcoded ports (e.g., 9099, 8081, 9199)
  # Look for isPortInUse with numeric literals (but not FIREBASE_PORTS usage)
  if grep -E 'isPortInUse\s*\(\s*[0-9]{4}\s*\)' "$global_setup" | grep -v "FIREBASE_PORTS" >/dev/null 2>&1; then
    test_fail "printsync global-setup.ts uses FIREBASE_PORTS" "Found hardcoded port numbers in isPortInUse calls"
    return
  fi

  test_pass "printsync global-setup.ts uses FIREBASE_PORTS"
}

# ============================================================================
# Run All Tests
# ============================================================================

echo "========================================"
echo "Firebase Configuration Consistency Tests"
echo "========================================"

run_test test_firebase_json_has_emulator_config
run_test test_firebase_ports_ts_matches_json
run_test test_firebase_js_imports_from_shared_config
run_test test_no_hardcoded_ports_in_firebase_js
run_test test_allocate_test_ports_matches_json
run_test test_generate_firebase_ports_works
run_test test_printsync_global_setup_uses_firebase_ports

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
