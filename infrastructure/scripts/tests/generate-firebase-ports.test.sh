#!/usr/bin/env bash
# Test suite for generate-firebase-ports.sh error handling

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GENERATE_SCRIPT="$REPO_ROOT/infrastructure/scripts/generate-firebase-ports.sh"

# Test helpers
test_count=0
pass_count=0
fail_count=0

assert_failure() {
  local test_name="$1"
  local expected_error="$2"
  shift 2

  test_count=$((test_count + 1))

  if output=$("$@" 2>&1); then
    echo "✗ $test_name: Expected failure but succeeded"
    fail_count=$((fail_count + 1))
    return 1
  fi

  if echo "$output" | grep -q "$expected_error"; then
    echo "✓ $test_name"
    pass_count=$((pass_count + 1))
    return 0
  else
    echo "✗ $test_name: Expected error containing '$expected_error', got:"
    echo "$output"
    fail_count=$((fail_count + 1))
    return 1
  fi
}

# Test 1: Missing firebase.json
test_missing_firebase_json() {
  local temp_dir=$(mktemp -d)
  local fake_script="$temp_dir/generate-firebase-ports.sh"

  # Copy script but point to nonexistent firebase.json
  sed 's|REPO_ROOT=".*"|REPO_ROOT="'"$temp_dir"'"|' "$GENERATE_SCRIPT" > "$fake_script"
  chmod +x "$fake_script"

  assert_failure "test_missing_firebase_json" "firebase.json not found" "$fake_script"

  rm -rf "$temp_dir"
}

# Test 2: Missing jq (mock by using PATH override)
test_missing_jq() {
  local temp_dir=$(mktemp -d)
  local fake_script="$temp_dir/generate-firebase-ports.sh"

  # Create minimal firebase.json
  cat > "$temp_dir/firebase.json" <<EOF
{
  "emulators": {
    "auth": {"port": 9099},
    "firestore": {"port": 8080},
    "storage": {"port": 9199},
    "ui": {"port": 4000}
  }
}
EOF

  # Copy script and modify to use limited PATH
  {
    echo '#!/usr/bin/env bash'
    echo 'export PATH="/usr/bin:/bin"  # Minimal PATH to hide jq if not in /usr/bin'
    tail -n +2 "$GENERATE_SCRIPT" | sed 's|REPO_ROOT=".*"|REPO_ROOT="'"$temp_dir"'"|'
  } > "$fake_script"
  chmod +x "$fake_script"

  # This test might be fragile - skip if jq is in /usr/bin or /bin
  if command -v jq | grep -qE "/(usr/)?bin/jq"; then
    echo "⊘ test_missing_jq: Skipped (jq in /usr/bin or /bin)"
    test_count=$((test_count + 1))
  else
    assert_failure "test_missing_jq" "jq is required but not installed" "$fake_script"
  fi

  rm -rf "$temp_dir"
}

# Test 3: Invalid JSON
test_invalid_json() {
  local temp_dir=$(mktemp -d)
  local fake_script="$temp_dir/generate-firebase-ports.sh"

  # Create invalid JSON
  cat > "$temp_dir/firebase.json" <<EOF
{
  "emulators": {
    "auth": {"port": 9099
  }
}
EOF

  sed 's|REPO_ROOT=".*"|REPO_ROOT="'"$temp_dir"'"|' "$GENERATE_SCRIPT" > "$fake_script"
  chmod +x "$fake_script"

  assert_failure "test_invalid_json" "jq failed" "$fake_script"

  rm -rf "$temp_dir"
}

# Test 4: Null port value
test_null_port() {
  local temp_dir=$(mktemp -d)
  local fake_script="$temp_dir/generate-firebase-ports.sh"

  cat > "$temp_dir/firebase.json" <<EOF
{
  "emulators": {
    "auth": {"port": null},
    "firestore": {"port": 8080},
    "storage": {"port": 9199},
    "ui": {"port": 4000}
  }
}
EOF

  sed 's|REPO_ROOT=".*"|REPO_ROOT="'"$temp_dir"'"|' "$GENERATE_SCRIPT" > "$fake_script"
  chmod +x "$fake_script"

  assert_failure "test_null_port" "port is missing or null" "$fake_script"

  rm -rf "$temp_dir"
}

# Test 5: Non-numeric port
test_invalid_port_number() {
  local temp_dir=$(mktemp -d)
  local fake_script="$temp_dir/generate-firebase-ports.sh"

  cat > "$temp_dir/firebase.json" <<EOF
{
  "emulators": {
    "auth": {"port": "invalid"},
    "firestore": {"port": 8080},
    "storage": {"port": 9199},
    "ui": {"port": 4000}
  }
}
EOF

  sed 's|REPO_ROOT=".*"|REPO_ROOT="'"$temp_dir"'"|' "$GENERATE_SCRIPT" > "$fake_script"
  chmod +x "$fake_script"

  assert_failure "test_invalid_port_number" "port is not a valid number" "$fake_script"

  rm -rf "$temp_dir"
}

# Test 6: Port out of range (< 1)
test_port_too_low() {
  local temp_dir=$(mktemp -d)
  local fake_script="$temp_dir/generate-firebase-ports.sh"

  cat > "$temp_dir/firebase.json" <<EOF
{
  "emulators": {
    "auth": {"port": 0},
    "firestore": {"port": 8080},
    "storage": {"port": 9199},
    "ui": {"port": 4000}
  }
}
EOF

  sed 's|REPO_ROOT=".*"|REPO_ROOT="'"$temp_dir"'"|' "$GENERATE_SCRIPT" > "$fake_script"
  chmod +x "$fake_script"

  assert_failure "test_port_too_low" "port out of range" "$fake_script"

  rm -rf "$temp_dir"
}

# Test 7: Port out of range (> 65535)
test_port_too_high() {
  local temp_dir=$(mktemp -d)
  local fake_script="$temp_dir/generate-firebase-ports.sh"

  cat > "$temp_dir/firebase.json" <<EOF
{
  "emulators": {
    "auth": {"port": 65536},
    "firestore": {"port": 8080},
    "storage": {"port": 9199},
    "ui": {"port": 4000}
  }
}
EOF

  sed 's|REPO_ROOT=".*"|REPO_ROOT="'"$temp_dir"'"|' "$GENERATE_SCRIPT" > "$fake_script"
  chmod +x "$fake_script"

  assert_failure "test_port_too_high" "port out of range" "$fake_script"

  rm -rf "$temp_dir"
}

# Test 8: Output format is sourceable (success path test)
test_output_format_is_sourceable() {
  test_count=$((test_count + 1))

  local output=$("$GENERATE_SCRIPT" 2>&1)

  # Verify output contains exactly 4 lines
  local line_count=$(echo "$output" | wc -l | tr -d ' ')
  if [ "$line_count" != "4" ]; then
    echo "✗ test_output_format_is_sourceable: Expected 4 lines, got $line_count"
    fail_count=$((fail_count + 1))
    return 1
  fi

  # Verify each line matches VAR_NAME=VALUE format (no export, no quotes around value)
  if ! echo "$output" | grep -qE '^AUTH_PORT=[0-9]+$'; then
    echo "✗ test_output_format_is_sourceable: AUTH_PORT line has unexpected format"
    echo "Expected: AUTH_PORT=9099"
    echo "Got: $(echo "$output" | grep AUTH_PORT || echo "AUTH_PORT line missing")"
    fail_count=$((fail_count + 1))
    return 1
  fi

  if ! echo "$output" | grep -qE '^FIRESTORE_PORT=[0-9]+$'; then
    echo "✗ test_output_format_is_sourceable: FIRESTORE_PORT line has unexpected format"
    fail_count=$((fail_count + 1))
    return 1
  fi

  if ! echo "$output" | grep -qE '^STORAGE_PORT=[0-9]+$'; then
    echo "✗ test_output_format_is_sourceable: STORAGE_PORT line has unexpected format"
    fail_count=$((fail_count + 1))
    return 1
  fi

  if ! echo "$output" | grep -qE '^UI_PORT=[0-9]+$'; then
    echo "✗ test_output_format_is_sourceable: UI_PORT line has unexpected format"
    fail_count=$((fail_count + 1))
    return 1
  fi

  # Verify output is sourceable (can be evaluated as shell commands)
  # Create a subshell to test sourcing without polluting current environment
  if ! (source <(echo "$output") 2>&1); then
    echo "✗ test_output_format_is_sourceable: Output cannot be sourced"
    fail_count=$((fail_count + 1))
    return 1
  fi

  # Verify all expected variables are set after sourcing
  local test_result
  test_result=$(
    source <(echo "$output")
    if [ -z "${AUTH_PORT:-}" ] || [ -z "${FIRESTORE_PORT:-}" ] || \
       [ -z "${STORAGE_PORT:-}" ] || [ -z "${UI_PORT:-}" ]; then
      echo "MISSING_VARS"
    else
      echo "OK"
    fi
  )

  if [ "$test_result" != "OK" ]; then
    echo "✗ test_output_format_is_sourceable: Variables not set after sourcing"
    fail_count=$((fail_count + 1))
    return 1
  fi

  echo "✓ test_output_format_is_sourceable"
  pass_count=$((pass_count + 1))
  return 0
}

# Run all tests
echo "Running generate-firebase-ports.sh tests..."
echo

test_missing_firebase_json
test_missing_jq
test_invalid_json
test_null_port
test_invalid_port_number
test_port_too_low
test_port_too_high
test_output_format_is_sourceable

echo
echo "Results: $pass_count passed, $fail_count failed, $test_count total"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
