#!/usr/bin/env bash
# Configuration consistency tests for Firebase ports
#
# Ensures that hardcoded ports in various configuration files match
# the ports defined in firebase.json (the source of truth).
#
# Prevents configuration drift by failing tests when ports don't match,
# catching mismatches in CI/pre-commit before they cause connection
# failures and confusing "connection refused" errors.
#
# Related files:
# - firebase.json: Source of truth for emulator configuration
# - shared/config/firebase-ports.ts: TypeScript constants exported to apps
# - printsync/tests/global-setup.ts: Uses FIREBASE_PORTS for emulator connection in tests
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

# TODO(#1225): Add unit tests for validate_port function
# Validates that a port value is numeric and in valid range (1-65535)
# Args: $1 = port name (e.g., "firestore"), $2 = port value
# Output: Echoes error message if invalid, nothing if valid
# Usage: error=$(validate_port "name" "$value"); if [ -n "$error" ]; then ...; fi
validate_port() {
  local name=$1
  local value=$2

  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "${name} not numeric: '$value'"
    return
  fi

  if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    echo "${name} out of range: $value"
    return
  fi
}

# Validates all four Firebase ports at once
# Args: $1 = prefix (e.g., "firebase.json" or "sh" or "generated")
#       $2 = firestore port, $3 = auth port, $4 = storage port, $5 = ui port
# Returns: Echoes concatenated error messages if any invalid, empty string if all valid
validate_all_firebase_ports() {
  local prefix=$1
  local firestore=$2
  local auth=$3
  local storage=$4
  local ui=$5

  local errors=""
  for port_info in "firestore:$firestore" "auth:$auth" "storage:$storage" "ui:$ui"; do
    local name="${port_info%%:*}"
    local value="${port_info#*:}"
    local error=$(validate_port "$name port in $prefix" "$value")
    [ -n "$error" ] && errors="${errors}${error}; "
  done
  echo "$errors"
}

# Compares all four Firebase ports between two sources
# Args: $1 = source1 name, $2 = source2 name
#       $3 = firestore1, $4 = firestore2, $5 = auth1, $6 = auth2
#       $7 = storage1, $8 = storage2, $9 = ui1, ${10} = ui2
# Returns: Echoes concatenated mismatch messages if any differ, empty string if all match
compare_firebase_ports() {
  local source1_name=$1
  local source2_name=$2
  local firestore1=$3
  local firestore2=$4
  local auth1=$5
  local auth2=$6
  local storage1=$7
  local storage2=$8
  local ui1=$9
  local ui2=${10}

  local mismatches=""
  [ "$firestore1" != "$firestore2" ] && mismatches="${mismatches}Firestore: ${source1_name}=$firestore1, ${source2_name}=$firestore2; "
  [ "$auth1" != "$auth2" ] && mismatches="${mismatches}Auth: ${source1_name}=$auth1, ${source2_name}=$auth2; "
  [ "$storage1" != "$storage2" ] && mismatches="${mismatches}Storage: ${source1_name}=$storage1, ${source2_name}=$storage2; "
  [ "$ui1" != "$ui2" ] && mismatches="${mismatches}UI: ${source1_name}=$ui1, ${source2_name}=$ui2; "
  echo "$mismatches"
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

  # Extract ports from firebase-ports.ts using grep
  # Match patterns like: firestore: createPort<FirestorePort>(8081, 'Firestore'),
  local firestore_ts=$(grep 'firestore: createPort' "$firebase_ports_ts" | grep -o 'createPort<[^>]*>([0-9]*' | grep -o '[0-9]*')
  local auth_ts=$(grep 'auth: createPort' "$firebase_ports_ts" | grep -o 'createPort<[^>]*>([0-9]*' | grep -o '[0-9]*')
  local storage_ts=$(grep 'storage: createPort' "$firebase_ports_ts" | grep -o 'createPort<[^>]*>([0-9]*' | grep -o '[0-9]*')
  local ui_ts=$(grep 'ui: createPort' "$firebase_ports_ts" | grep -o 'createPort<[^>]*>([0-9]*' | grep -o '[0-9]*')

  # Compare ports
  local mismatches=$(compare_firebase_ports "json" "ts" \
    "$firestore_json" "$firestore_ts" \
    "$auth_json" "$auth_ts" \
    "$storage_json" "$storage_ts" \
    "$ui_json" "$ui_ts")

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

  # Extract ports from firebase.json with validation
  local firestore_json=$(jq -r '.emulators.firestore.port' "$firebase_json" 2>/dev/null)
  local auth_json=$(jq -r '.emulators.auth.port' "$firebase_json" 2>/dev/null)
  local storage_json=$(jq -r '.emulators.storage.port' "$firebase_json" 2>/dev/null)
  local ui_json=$(jq -r '.emulators.ui.port' "$firebase_json" 2>/dev/null)

  # Validate firebase.json ports before proceeding
  # TODO(#1227): Log validation errors immediately, not just on failure
  local json_errors=$(validate_all_firebase_ports "firebase.json" \
    "$firestore_json" "$auth_json" "$storage_json" "$ui_json")

  if [ -n "$json_errors" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "firebase.json has invalid port configuration: $json_errors"
    return
  fi

  # Create temp files atomically with validation
  local temp_output
  temp_output=$(mktemp) || {
    test_fail "allocate-test-ports.sh matches firebase.json" "Failed to create temp file (check /tmp space: df -h /tmp)"
    return
  }

  local temp_errors
  temp_errors=$(mktemp) || {
    rm -f "$temp_output"  # Clean up first temp file
    test_fail "allocate-test-ports.sh matches firebase.json" "Failed to create temp file (check /tmp space: df -h /tmp)"
    return
  }

  # TODO(#1228): Silent cleanup failures could hide filesystem issues (disk full, permissions)
  trap "rm -f '$temp_output' '$temp_errors'" RETURN

  # Verify no port variables are set before test
  local vars_before=$(env | grep -E '^(AUTH|FIRESTORE|STORAGE|UI)_PORT=' || true)
  if [ -n "$vars_before" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "Test environment contaminated with port variables: $vars_before"
    return
  fi

  # Source allocate-test-ports.sh to validate it loads ports from generate-firebase-ports.sh
  # This test verifies: (1) sourcing completes without errors, (2) all port variables are set,
  # (3) port values match firebase.json
  # Uses subshell to isolate port variables - if they persisted to the parent shell,
  # subsequent tests would fail their environment cleanliness checks (see vars_before)

  # Source allocate-test-ports.sh in subshell and capture exit status
  set +e  # Temporarily disable exit on error to capture status
  (
    # Unset any existing port variables to ensure clean test
    unset AUTH_PORT FIRESTORE_PORT STORAGE_PORT UI_PORT

    # Source the script (it will load ports via generate-firebase-ports.sh)
    source "$allocate_script"

    # Export ports for parent shell to verify
    echo "FIRESTORE_PORT=${FIRESTORE_PORT}"
    echo "AUTH_PORT=${AUTH_PORT}"
    echo "STORAGE_PORT=${STORAGE_PORT}"
    echo "UI_PORT=${UI_PORT}"
  ) > "$temp_output" 2> "$temp_errors"
  subshell_status=$?
  set -e

  # Check if sourcing failed
  if [ $subshell_status -ne 0 ]; then
    local error_msg="allocate-test-ports.sh exited with status $subshell_status"
    if [ -s "$temp_errors" ]; then
      error_msg="${error_msg}. Errors: $(cat "$temp_errors")"
    fi
    test_fail "allocate-test-ports.sh matches firebase.json" "$error_msg"
    return
  fi

  # Also check for stderr even on success (warnings, etc.)
  if [ -s "$temp_errors" ]; then
    echo "  Warning: Script produced stderr output:"
    cat "$temp_errors"
  fi

  # Check if output is complete
  if [ ! -s "$temp_output" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "Script succeeded but produced no output (unexpected)"
    return
  fi

  # Read the sourced ports
  local firestore_sh=$(grep '^FIRESTORE_PORT=' "$temp_output" | cut -d= -f2)
  local auth_sh=$(grep '^AUTH_PORT=' "$temp_output" | cut -d= -f2)
  local storage_sh=$(grep '^STORAGE_PORT=' "$temp_output" | cut -d= -f2)
  local ui_sh=$(grep '^UI_PORT=' "$temp_output" | cut -d= -f2)

  # Validate we got all required ports
  if [ -z "$firestore_sh" ] || [ -z "$auth_sh" ] || [ -z "$storage_sh" ] || [ -z "$ui_sh" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "Script did not export all required ports"
    return
  fi

  # Verify subshell didn't pollute parent environment
  local vars_after=$(env | grep -E '^(AUTH|FIRESTORE|STORAGE|UI)_PORT=' || true)
  if [ -n "$vars_after" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "Subshell leaked port variables to parent: $vars_after"
    return
  fi

  # Validate ports are numeric and in valid range before comparing
  local validation_errors=$(validate_all_firebase_ports "sh" \
    "$firestore_sh" "$auth_sh" "$storage_sh" "$ui_sh")

  if [ -n "$validation_errors" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "Port validation errors: $validation_errors"
    return
  fi

  # Compare ports
  local mismatches=$(compare_firebase_ports "json" "sh" \
    "$firestore_json" "$firestore_sh" \
    "$auth_json" "$auth_sh" \
    "$storage_json" "$storage_sh" \
    "$ui_json" "$ui_sh")

  if [ -n "$mismatches" ]; then
    test_fail "allocate-test-ports.sh matches firebase.json" "Port mismatches: $mismatches"
    return
  fi

  test_pass "allocate-test-ports.sh matches firebase.json"
}

test_allocate_test_ports_integration() {
  # Create a minimal test script that sources allocate-test-ports.sh
  local test_script="/tmp/test-consumer-$$.sh"
  trap "rm -f '$test_script'" RETURN

  cat > "$test_script" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source "${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"

# Verify all port variables are set and numeric
if ! [[ "$AUTH_PORT" =~ ^[0-9]+$ ]]; then
  echo "AUTH_PORT not numeric: $AUTH_PORT" >&2
  exit 1
fi

if ! [[ "$FIRESTORE_PORT" =~ ^[0-9]+$ ]]; then
  echo "FIRESTORE_PORT not numeric: $FIRESTORE_PORT" >&2
  exit 1
fi

if ! [[ "$STORAGE_PORT" =~ ^[0-9]+$ ]]; then
  echo "STORAGE_PORT not numeric: $STORAGE_PORT" >&2
  exit 1
fi

if ! [[ "$UI_PORT" =~ ^[0-9]+$ ]]; then
  echo "UI_PORT not numeric: $UI_PORT" >&2
  exit 1
fi

echo "SUCCESS: Ports loaded: AUTH=$AUTH_PORT FIRESTORE=$FIRESTORE_PORT STORAGE=$STORAGE_PORT UI=$UI_PORT"
EOF

  chmod +x "$test_script"

  # Execute the test consumer with REPO_ROOT set
  local output
  if ! output=$(REPO_ROOT="$REPO_ROOT" bash "$test_script" 2>&1); then
    test_fail "allocate-test-ports.sh integration test" "Consumer script failed: $output"
    return
  fi

  if ! echo "$output" | grep -q "SUCCESS"; then
    test_fail "allocate-test-ports.sh integration test" "Unexpected output: $output"
    return
  fi

  test_pass "allocate-test-ports.sh integration test"
}

test_allocate_sources_generate_script() {
  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"

  if [ ! -f "$allocate_script" ]; then
    test_fail "allocate-test-ports.sh sources generate-firebase-ports.sh" "allocate-test-ports.sh not found"
    return
  fi

  # Verify script executes generate-firebase-ports.sh (not hardcoded ports)
  if ! grep -q 'generate-firebase-ports\.sh' "$allocate_script"; then
    test_fail "allocate-test-ports.sh sources generate-firebase-ports.sh" "No reference to generate-firebase-ports.sh found"
    return
  fi

  # Verify no hardcoded port assignments exist (AUTH_PORT=9099 style)
  # Allow PORT_OFFSET which is a parameter, not a port value
  local hardcoded=$(grep -E '(AUTH|FIRESTORE|STORAGE|UI)_PORT=[0-9]{4}' "$allocate_script" || true)

  if [ -n "$hardcoded" ]; then
    test_fail "allocate-test-ports.sh sources generate-firebase-ports.sh" "Found hardcoded port assignments: $hardcoded"
    return
  fi

  test_pass "allocate-test-ports.sh sources generate-firebase-ports.sh"
}

test_generate_firebase_ports_works() {
  local generate_script="${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh"
  local firebase_json="${REPO_ROOT}/firebase.json"

  if [ ! -f "$generate_script" ] || [ ! -f "$firebase_json" ]; then
    test_fail "generate-firebase-ports.sh works correctly" "Required files not found"
    return
  fi

  # Extract expected ports from firebase.json with validation
  local firestore_json=$(jq -r '.emulators.firestore.port' "$firebase_json" 2>/dev/null)
  local auth_json=$(jq -r '.emulators.auth.port' "$firebase_json" 2>/dev/null)
  local storage_json=$(jq -r '.emulators.storage.port' "$firebase_json" 2>/dev/null)
  local ui_json=$(jq -r '.emulators.ui.port' "$firebase_json" 2>/dev/null)

  # Validate firebase.json has valid port configuration
  local json_errors=$(validate_all_firebase_ports "firebase.json" \
    "$firestore_json" "$auth_json" "$storage_json" "$ui_json")

  if [ -n "$json_errors" ]; then
    test_fail "generate-firebase-ports.sh works correctly" "firebase.json validation failed: $json_errors"
    return
  fi

  # Use temp files for output and errors
  local gen_output="/tmp/gen_ports_output_$$.txt"
  local gen_errors="/tmp/gen_ports_errors_$$.txt"
  trap "rm -f '$gen_output' '$gen_errors'" RETURN

  # Run the script and capture output
  if ! "$generate_script" > "$gen_output" 2> "$gen_errors"; then
    local error_msg="generate-firebase-ports.sh failed"
    if [ -s "$gen_errors" ]; then
      error_msg="${error_msg}. Errors: $(cat "$gen_errors")"
    fi
    test_fail "generate-firebase-ports.sh works correctly" "$error_msg"
    return
  fi

  # Source the validated output
  source "$gen_output"

  # Verify ports were loaded and match firebase.json
  local mismatches=""

  # Check all ports are set
  if [ -z "${FIRESTORE_PORT:-}" ]; then
    mismatches="${mismatches}FIRESTORE_PORT not set; "
  fi
  if [ -z "${AUTH_PORT:-}" ]; then
    mismatches="${mismatches}AUTH_PORT not set; "
  fi
  if [ -z "${STORAGE_PORT:-}" ]; then
    mismatches="${mismatches}STORAGE_PORT not set; "
  fi
  if [ -z "${UI_PORT:-}" ]; then
    mismatches="${mismatches}UI_PORT not set; "
  fi

  if [ -z "$mismatches" ]; then
    # All ports set - validate them
    local validation_errors=$(validate_all_firebase_ports "generated" \
      "$FIRESTORE_PORT" "$AUTH_PORT" "$STORAGE_PORT" "$UI_PORT")

    if [ -n "$validation_errors" ]; then
      mismatches="$validation_errors"
    else
      # Validation passed - compare with firebase.json
      mismatches=$(compare_firebase_ports "json" "generated" \
        "$firestore_json" "$FIRESTORE_PORT" \
        "$auth_json" "$AUTH_PORT" \
        "$storage_json" "$STORAGE_PORT" \
        "$ui_json" "$UI_PORT")
    fi
  fi

  if [ -n "$mismatches" ]; then
    test_fail "generate-firebase-ports.sh works correctly" "Port validation failures: $mismatches"
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

  # Verify isPortInUse calls use FIREBASE_PORTS, not hardcoded port numbers
  # Uses 4-digit pattern to catch typical port numbers (matches current Firebase emulator ports)
  local hardcoded_ports=$(grep -n 'isPortInUse' "$global_setup" | grep -E '[0-9]{4}' | grep -v 'FIREBASE_PORTS' || true)

  if [ -n "$hardcoded_ports" ]; then
    test_fail "printsync global-setup.ts uses FIREBASE_PORTS" "Found hardcoded ports in isPortInUse calls: $hardcoded_ports"
    return
  fi

  # Verify FIREBASE_PORTS appears in actual code (not just imports/comments)
  # Count occurrences outside of comments and import lines
  # Expect at least 3: FIREBASE_PORTS.auth, FIREBASE_PORTS.firestore, FIREBASE_PORTS.storage
  local usage_count=$(grep -v '^[[:space:]]*//' "$global_setup" | \
                      grep -v '^import' | \
                      grep -c 'FIREBASE_PORTS\.' || echo "0")

  if [ "$usage_count" -lt 3 ]; then
    test_fail "printsync global-setup.ts uses FIREBASE_PORTS" "Expected at least 3 FIREBASE_PORTS usages in code, found $usage_count"
    return
  fi

  test_pass "printsync global-setup.ts uses FIREBASE_PORTS"
}

test_printsync_global_setup_no_hardcoded_ports() {
  local global_setup="${REPO_ROOT}/printsync/tests/global-setup.ts"

  if [ ! -f "$global_setup" ]; then
    test_fail "printsync global-setup.ts has no hardcoded ports" "File not found at $global_setup"
    return
  fi

  # Check for any common Firebase emulator port numbers outside of FIREBASE_PORTS references
  # Common ports: 4000 (hosting), 8081 (firestore), 9099 (auth), 9199 (storage)
  local hardcoded=$(grep -n -E '\b(4000|8081|9099|9199)\b' "$global_setup" | \
                    grep -v 'FIREBASE_PORTS' | \
                    grep -v '^[[:space:]]*//' | \
                    grep -v 'import' || true)

  if [ -n "$hardcoded" ]; then
    test_fail "printsync global-setup.ts has no hardcoded ports" "Found hardcoded ports: $hardcoded"
    return
  fi

  test_pass "printsync global-setup.ts has no hardcoded ports"
}

test_allocate_test_ports_handles_missing_firebase_json() {
  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"
  local firebase_json="${REPO_ROOT}/firebase.json"

  if [ ! -f "$allocate_script" ]; then
    test_fail "allocate-test-ports.sh handles missing firebase.json" "allocate-test-ports.sh not found"
    return
  fi

  if [ ! -f "$firebase_json" ]; then
    test_fail "allocate-test-ports.sh handles missing firebase.json" "firebase.json not found (cannot test)"
    return
  fi

  # Create temp directory for test
  local test_dir=$(mktemp -d)
  # TODO(#1173): Add warning if cleanup fails to detect filesystem issues
  trap "rm -rf '$test_dir'" RETURN

  # Set up directory structure that generate-firebase-ports.sh expects
  mkdir -p "${test_dir}/infrastructure/scripts"
  local test_allocate="${test_dir}/infrastructure/scripts/allocate-test-ports.sh"
  local test_generate="${test_dir}/infrastructure/scripts/generate-firebase-ports.sh"
  local test_port_utils="${test_dir}/infrastructure/scripts/port-utils.sh"

  cp "$allocate_script" "$test_allocate"
  cp "${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh" "$test_generate"
  cp "${REPO_ROOT}/infrastructure/scripts/port-utils.sh" "$test_port_utils"

  # Make scripts executable
  chmod +x "$test_allocate" "$test_generate"

  # Create a temporary git repository (required by allocate-test-ports.sh)
  (
    cd "$test_dir"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # Run allocate script without firebase.json - should fail with clear error
    local output=$(SCRIPT_DIR="${test_dir}/infrastructure/scripts" bash "$test_allocate" 2>&1 || true)

    # Verify it failed with appropriate error message
    if ! echo "$output" | grep -q "FATAL: generate-firebase-ports.sh failed"; then
      test_fail "allocate-test-ports.sh handles missing firebase.json" "Missing 'FATAL: generate-firebase-ports.sh failed' message"
      return
    fi

    # Verify actual error from generate-firebase-ports.sh is shown
    if ! echo "$output" | grep -q "ERROR: firebase.json not found"; then
      test_fail "allocate-test-ports.sh handles missing firebase.json" "Missing 'ERROR: firebase.json not found' message from generator"
      return
    fi

    # Verify troubleshooting steps are shown
    if ! echo "$output" | grep -q "Check that:"; then
      test_fail "allocate-test-ports.sh handles missing firebase.json" "Missing troubleshooting steps"
      return
    fi
  )

  test_pass "allocate-test-ports.sh handles missing firebase.json"
}

test_allocate_test_ports_handles_corrupted_firebase_json() {
  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"
  local firebase_json="${REPO_ROOT}/firebase.json"

  if [ ! -f "$allocate_script" ]; then
    test_fail "allocate-test-ports.sh handles corrupted firebase.json" "allocate-test-ports.sh not found"
    return
  fi

  if [ ! -f "$firebase_json" ]; then
    test_fail "allocate-test-ports.sh handles corrupted firebase.json" "firebase.json not found (cannot test)"
    return
  fi

  # Create temp directory for test
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up directory structure that generate-firebase-ports.sh expects
  mkdir -p "${test_dir}/infrastructure/scripts"
  local test_allocate="${test_dir}/infrastructure/scripts/allocate-test-ports.sh"
  local test_generate="${test_dir}/infrastructure/scripts/generate-firebase-ports.sh"
  local test_port_utils="${test_dir}/infrastructure/scripts/port-utils.sh"

  cp "$allocate_script" "$test_allocate"
  cp "${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh" "$test_generate"
  cp "${REPO_ROOT}/infrastructure/scripts/port-utils.sh" "$test_port_utils"

  # Make scripts executable
  chmod +x "$test_allocate" "$test_generate"

  # Create a temporary git repository
  (
    cd "$test_dir"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # Create corrupted firebase.json (invalid JSON) at repo root
    echo "{ invalid json" > "${test_dir}/firebase.json"

    # Run allocate script - should fail with clear error
    local output=$(SCRIPT_DIR="${test_dir}/infrastructure/scripts" bash "$test_allocate" 2>&1 || true)

    # Verify it failed with appropriate error message
    if ! echo "$output" | grep -q "FATAL: generate-firebase-ports.sh failed"; then
      test_fail "allocate-test-ports.sh handles corrupted firebase.json" "Missing 'FATAL: generate-firebase-ports.sh failed' message"
      return
    fi

    # Verify jq parsing error is shown (matches "jq failed" messages)
    if ! echo "$output" | grep -q "ERROR: jq failed"; then
      test_fail "allocate-test-ports.sh handles corrupted firebase.json" "Missing jq error message"
      return
    fi

    # Verify JSON validation message is shown
    if ! echo "$output" | grep -q "Check that firebase.json is valid JSON"; then
      test_fail "allocate-test-ports.sh handles corrupted firebase.json" "Missing JSON validation suggestion"
      return
    fi
  )

  test_pass "allocate-test-ports.sh handles corrupted firebase.json"
}

test_allocate_test_ports_handles_missing_port_in_json() {
  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"

  if [ ! -f "$allocate_script" ]; then
    test_fail "allocate-test-ports.sh handles missing port in firebase.json" "allocate-test-ports.sh not found"
    return
  fi

  # Create temp directory for test
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up directory structure that generate-firebase-ports.sh expects
  mkdir -p "${test_dir}/infrastructure/scripts"
  local test_allocate="${test_dir}/infrastructure/scripts/allocate-test-ports.sh"
  local test_generate="${test_dir}/infrastructure/scripts/generate-firebase-ports.sh"
  local test_port_utils="${test_dir}/infrastructure/scripts/port-utils.sh"

  cp "$allocate_script" "$test_allocate"
  cp "${REPO_ROOT}/infrastructure/scripts/generate-firebase-ports.sh" "$test_generate"
  cp "${REPO_ROOT}/infrastructure/scripts/port-utils.sh" "$test_port_utils"

  # Make scripts executable
  chmod +x "$test_allocate" "$test_generate"

  # Create a temporary git repository
  (
    cd "$test_dir"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # Create firebase.json with missing auth port at repo root
    cat > "${test_dir}/firebase.json" <<EOF
{
  "emulators": {
    "firestore": { "port": 8081 },
    "storage": { "port": 8082 },
    "ui": { "port": 8083 }
  }
}
EOF

    # Run allocate script - should fail with clear error
    local output=$(SCRIPT_DIR="${test_dir}/infrastructure/scripts" bash "$test_allocate" 2>&1 || true)

    # Verify it failed with appropriate error message
    if ! echo "$output" | grep -q "FATAL: generate-firebase-ports.sh failed"; then
      test_fail "allocate-test-ports.sh handles missing port in firebase.json" "Missing 'FATAL: generate-firebase-ports.sh failed' message"
      return
    fi

    # Verify specific error about missing auth port
    if ! echo "$output" | grep -q "ERROR: auth port is missing or null in firebase.json"; then
      test_fail "allocate-test-ports.sh handles missing port in firebase.json" "Missing specific auth port error"
      return
    fi
  )

  test_pass "allocate-test-ports.sh handles missing port in firebase.json"
}

test_allocate_detects_incomplete_generator_output() {
  local allocate_script="${REPO_ROOT}/infrastructure/scripts/allocate-test-ports.sh"

  if [ ! -f "$allocate_script" ]; then
    test_fail "allocate-test-ports.sh detects incomplete generator output" "allocate-test-ports.sh not found"
    return
  fi

  # Create temp directory for test
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up directory structure
  mkdir -p "${test_dir}/infrastructure/scripts"
  local test_allocate="${test_dir}/infrastructure/scripts/allocate-test-ports.sh"
  local test_port_utils="${test_dir}/infrastructure/scripts/port-utils.sh"

  # Create a fake generate script that succeeds but outputs incomplete data
  cat > "${test_dir}/infrastructure/scripts/generate-firebase-ports.sh" <<'INNER_EOF'
#!/bin/bash
echo "AUTH_PORT=9099"
echo "FIRESTORE_PORT=8081"
# Missing STORAGE_PORT and UI_PORT - simulates incomplete output
exit 0
INNER_EOF
  chmod +x "${test_dir}/infrastructure/scripts/generate-firebase-ports.sh"

  # Copy dependencies that allocate-test-ports.sh needs
  cp "${REPO_ROOT}/infrastructure/scripts/port-utils.sh" "$test_port_utils"
  cp "$allocate_script" "$test_allocate"

  # Create minimal git repo for worktree detection
  (
    cd "$test_dir"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # Verify allocate script detects missing ports
    local output
    output=$(SCRIPT_DIR="${test_dir}/infrastructure/scripts" bash "$test_allocate" 2>&1) && {
      test_fail "allocate-test-ports.sh detects incomplete generator output" "Script should reject incomplete port configuration"
      return
    }

    # Verify error message mentions specific missing ports
    if echo "$output" | grep -q "STORAGE_PORT" && echo "$output" | grep -q "UI_PORT"; then
      test_pass "allocate-test-ports.sh detects incomplete generator output"
    else
      test_fail "allocate-test-ports.sh detects incomplete generator output" "Error message should list missing ports (STORAGE_PORT, UI_PORT)"
    fi
  )
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
run_test test_allocate_test_ports_integration
run_test test_allocate_sources_generate_script
run_test test_generate_firebase_ports_works
run_test test_printsync_global_setup_uses_firebase_ports
run_test test_printsync_global_setup_no_hardcoded_ports
run_test test_allocate_test_ports_handles_missing_firebase_json
run_test test_allocate_test_ports_handles_corrupted_firebase_json
run_test test_allocate_test_ports_handles_missing_port_in_json
run_test test_allocate_detects_incomplete_generator_output

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
