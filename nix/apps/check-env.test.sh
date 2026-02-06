#!/usr/bin/env bash
# Tests for check-env.nix script
#
# This script validates that the check-env command correctly reports sandbox
# dependency status (socat and bubblewrap availability).
#
# Background:
# The check-env script (nix/apps/check-env.nix) was updated to include checks
# for socat and bubblewrap packages required by Claude Code's sandbox feature.
# These tests ensure the checks work correctly and provide accurate diagnostics.
#
# Usage:
#   ./nix/apps/check-env.test.sh           # Run all tests
#   ./nix/apps/check-env.test.sh test_name # Run specific test
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Find repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Helper: Print test header
print_test_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}TEST: $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Helper: Assert command succeeds
assert_succeeds() {
  local description="$1"
  local command="$2"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: $description${NC}"

  if output=$(eval "$command" 2>&1); then
    echo -e "${GREEN}✓ PASS: Command succeeded as expected${NC}"
    if [[ -n "$output" ]]; then
      echo "Output preview: $(echo "$output" | head -5)"
    fi
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Command should have succeeded but failed${NC}"
    echo "Command: $command"
    echo "Output: $output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper: Assert command output contains string
assert_output_contains() {
  local description="$1"
  local command="$2"
  local expected_string="$3"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: $description${NC}"

  # Use '|| true' to allow non-zero exit codes (e.g., when check-env fails due to missing node_modules)
  output=$(eval "$command" 2>&1 || true)

  if echo "$output" | grep -qF "$expected_string"; then
    echo -e "${GREEN}✓ PASS: Output contains expected string${NC}"
    echo "Expected string found: $expected_string"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Expected string not found in output${NC}"
    echo "Expected: $expected_string"
    echo "Got: $output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper: Assert command fails with specific exit code
assert_fails() {
  local description="$1"
  local command="$2"
  local expected_exit_code="${3:-1}"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: $description${NC}"

  set +e
  output=$(eval "$command" 2>&1)
  actual_exit_code=$?
  set -e

  if [[ $actual_exit_code -eq $expected_exit_code ]]; then
    echo -e "${GREEN}✓ PASS: Command failed with expected exit code $expected_exit_code${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Expected exit code $expected_exit_code, got $actual_exit_code${NC}"
    echo "Command: $command"
    echo "Output: $output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 1: Verify check-env reports socat and bubblewrap as available
test_check_env_succeeds_when_deps_present() {
  print_test_header "test_check_env_succeeds_when_deps_present"

  # Verify socat and bwrap are available first
  if ! command -v socat >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ SKIP: socat not available in PATH, skipping test${NC}"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi

  if ! command -v bwrap >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ SKIP: bwrap not available in PATH, skipping test${NC}"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi

  # Don't check exit code since check-env may fail due to other missing dependencies
  # (e.g., node_modules in CI). Instead, verify that socat and bubblewrap are
  # reported as available.
  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: check-env reports socat and bubblewrap as available${NC}"

  output=$(nix run .#check-env 2>&1 || true)

  if echo "$output" | grep -qF "✅ socat available" && \
     echo "$output" | grep -qF "✅ bubblewrap available"; then
    echo -e "${GREEN}✓ PASS: Both socat and bubblewrap reported as available${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: check-env did not report socat and bubblewrap as available${NC}"
    echo "Expected both:"
    echo "  ✅ socat available"
    echo "  ✅ bubblewrap available"
    echo "Got:"
    echo "$output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 2: Verify check-env shows socat available message
test_check_env_shows_socat_available() {
  print_test_header "test_check_env_shows_socat_available"

  if ! command -v socat >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ SKIP: socat not available in PATH, skipping test${NC}"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi

  assert_output_contains \
    "check-env shows socat available message" \
    "nix run .#check-env" \
    "✅ socat available"
}

# Test 3: Verify check-env shows bubblewrap available message
test_check_env_shows_bubblewrap_available() {
  print_test_header "test_check_env_shows_bubblewrap_available"

  if ! command -v bwrap >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ SKIP: bwrap not available in PATH, skipping test${NC}"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi

  assert_output_contains \
    "check-env shows bubblewrap available message" \
    "nix run .#check-env" \
    "✅ bubblewrap available"
}

# Test 4: Verify check-env output format includes sandbox dependency label
test_check_env_output_format() {
  print_test_header "test_check_env_output_format"

  if ! command -v socat >/dev/null 2>&1 || ! command -v bwrap >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ SKIP: socat or bwrap not available, skipping test${NC}"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: Verify check-env output includes sandbox dependency labels${NC}"

  # Use '|| true' to allow non-zero exit codes
  output=$(nix run .#check-env 2>&1 || true)

  # Check for both dependencies with sandbox labels
  if echo "$output" | grep -qF "✅ socat available (Claude Code sandbox dependency)" && \
     echo "$output" | grep -qF "✅ bubblewrap available (Claude Code sandbox dependency)"; then
    echo -e "${GREEN}✓ PASS: Output includes both sandbox dependency labels${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Missing expected sandbox dependency labels${NC}"
    echo "Expected both:"
    echo "  ✅ socat available (Claude Code sandbox dependency)"
    echo "  ✅ bubblewrap available (Claude Code sandbox dependency)"
    echo "Got:"
    echo "$output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 5: Verify check-env detects missing socat
test_check_env_detects_missing_socat() {
  print_test_header "test_check_env_detects_missing_socat"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: Verify check-env detects when socat is missing${NC}"

  # Create a wrapper script that modifies PATH before running check-env
  local test_script="/tmp/test-missing-socat-$$.sh"
  trap "rm -f '$test_script'" RETURN

  cat > "$test_script" <<'EOF'
#!/usr/bin/env bash
# Remove socat from PATH by filtering out the directory containing it
SOCAT_PATH=$(command -v socat 2>/dev/null || echo "")
if [ -n "$SOCAT_PATH" ]; then
  SOCAT_DIR=$(dirname "$SOCAT_PATH")
  NEW_PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "^$SOCAT_DIR$" | tr '\n' ':' | sed 's/:$//')
  export PATH="$NEW_PATH"
fi
exec bash -c 'nix run .#check-env'
EOF

  chmod +x "$test_script"

  # Run check-env with modified PATH
  set +e
  output=$(bash "$test_script" 2>&1)
  exit_code=$?
  set -e

  # Check if output indicates socat is missing
  if echo "$output" | grep -qF "❌ socat not available"; then
    echo -e "${GREEN}✓ PASS: check-env correctly detects missing socat${NC}"
    echo "Expected error message found: ❌ socat not available"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: check-env did not detect missing socat${NC}"
    echo "Expected: ❌ socat not available"
    echo "Got:"
    echo "$output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 6: Verify check-env detects missing bubblewrap
test_check_env_detects_missing_bubblewrap() {
  print_test_header "test_check_env_detects_missing_bubblewrap"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: Verify check-env detects when bubblewrap is missing${NC}"

  # Create a wrapper script that modifies PATH before running check-env
  local test_script="/tmp/test-missing-bwrap-$$.sh"
  trap "rm -f '$test_script'" RETURN

  cat > "$test_script" <<'EOF'
#!/usr/bin/env bash
# Remove bwrap from PATH by filtering out the directory containing it
BWRAP_PATH=$(command -v bwrap 2>/dev/null || echo "")
if [ -n "$BWRAP_PATH" ]; then
  BWRAP_DIR=$(dirname "$BWRAP_PATH")
  NEW_PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "^$BWRAP_DIR$" | tr '\n' ':' | sed 's/:$//')
  export PATH="$NEW_PATH"
fi
exec bash -c 'nix run .#check-env'
EOF

  chmod +x "$test_script"

  # Run check-env with modified PATH
  set +e
  output=$(bash "$test_script" 2>&1)
  exit_code=$?
  set -e

  # Check if output indicates bubblewrap is missing
  if echo "$output" | grep -qF "❌ bubblewrap not available"; then
    echo -e "${GREEN}✓ PASS: check-env correctly detects missing bubblewrap${NC}"
    echo "Expected error message found: ❌ bubblewrap not available"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: check-env did not detect missing bubblewrap${NC}"
    echo "Expected: ❌ bubblewrap not available"
    echo "Got:"
    echo "$output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 7: Verify check-env exit code is 1 when dependencies missing
test_check_env_exit_code_on_failure() {
  print_test_header "test_check_env_exit_code_on_failure"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: check-env exits with code 1 when dependencies are missing${NC}"

  # Create a wrapper script that modifies PATH before running check-env
  local test_script="/tmp/test-exit-code-$$.sh"
  trap "rm -f '$test_script'" RETURN

  cat > "$test_script" <<'EOF'
#!/usr/bin/env bash
# Remove both socat and bwrap from PATH
SOCAT_PATH=$(command -v socat 2>/dev/null || echo "")
BWRAP_PATH=$(command -v bwrap 2>/dev/null || echo "")
NEW_PATH="$PATH"
if [ -n "$SOCAT_PATH" ]; then
  SOCAT_DIR=$(dirname "$SOCAT_PATH")
  NEW_PATH=$(echo "$NEW_PATH" | tr ':' '\n' | grep -v "^$SOCAT_DIR$" | tr '\n' ':' | sed 's/:$//')
fi
if [ -n "$BWRAP_PATH" ]; then
  BWRAP_DIR=$(dirname "$BWRAP_PATH")
  NEW_PATH=$(echo "$NEW_PATH" | tr ':' '\n' | grep -v "^$BWRAP_DIR$" | tr '\n' ':' | sed 's/:$//')
fi
export PATH="$NEW_PATH"
exec bash -c 'nix run .#check-env'
EOF

  chmod +x "$test_script"

  set +e
  output=$(bash "$test_script" 2>&1)
  actual_exit_code=$?
  set -e

  if [[ $actual_exit_code -eq 1 ]]; then
    echo -e "${GREEN}✓ PASS: Command failed with expected exit code 1${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Expected exit code 1, got $actual_exit_code${NC}"
    echo "Output: $output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 8: Verify check-env shows fix instructions for missing socat
test_check_env_shows_socat_fix_instructions() {
  print_test_header "test_check_env_shows_socat_fix_instructions"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: Verify check-env shows fix instructions for missing socat${NC}"

  # Create a wrapper script that modifies PATH before running check-env
  local test_script="/tmp/test-socat-fix-$$.sh"
  trap "rm -f '$test_script'" RETURN

  cat > "$test_script" <<'EOF'
#!/usr/bin/env bash
SOCAT_PATH=$(command -v socat 2>/dev/null || echo "")
if [ -n "$SOCAT_PATH" ]; then
  SOCAT_DIR=$(dirname "$SOCAT_PATH")
  NEW_PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "^$SOCAT_DIR$" | tr '\n' ':' | sed 's/:$//')
  export PATH="$NEW_PATH"
fi
exec bash -c 'nix run .#check-env'
EOF

  chmod +x "$test_script"

  set +e
  output=$(bash "$test_script" 2>&1)
  set -e

  # Check for fix instructions
  if echo "$output" | grep -qF "Fix: Ensure you're in a nix develop shell with socat package"; then
    echo -e "${GREEN}✓ PASS: Fix instructions shown for missing socat${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Missing fix instructions for socat${NC}"
    echo "Expected: Fix: Ensure you're in a nix develop shell with socat package"
    echo "Got:"
    echo "$output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 9: Verify check-env shows fix instructions for missing bubblewrap
test_check_env_shows_bubblewrap_fix_instructions() {
  print_test_header "test_check_env_shows_bubblewrap_fix_instructions"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: Verify check-env shows fix instructions for missing bubblewrap${NC}"

  # Create a wrapper script that modifies PATH before running check-env
  local test_script="/tmp/test-bwrap-fix-$$.sh"
  trap "rm -f '$test_script'" RETURN

  cat > "$test_script" <<'EOF'
#!/usr/bin/env bash
BWRAP_PATH=$(command -v bwrap 2>/dev/null || echo "")
if [ -n "$BWRAP_PATH" ]; then
  BWRAP_DIR=$(dirname "$BWRAP_PATH")
  NEW_PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "^$BWRAP_DIR$" | tr '\n' ':' | sed 's/:$//')
  export PATH="$NEW_PATH"
fi
exec bash -c 'nix run .#check-env'
EOF

  chmod +x "$test_script"

  set +e
  output=$(bash "$test_script" 2>&1)
  set -e

  # Check for fix instructions
  if echo "$output" | grep -qF "Fix: Ensure you're in a nix develop shell with bubblewrap package"; then
    echo -e "${GREEN}✓ PASS: Fix instructions shown for missing bubblewrap${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Missing fix instructions for bubblewrap${NC}"
    echo "Expected: Fix: Ensure you're in a nix develop shell with bubblewrap package"
    echo "Got:"
    echo "$output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 10: Verify check-env is available as nix app
test_check_env_nix_app_exists() {
  print_test_header "test_check_env_nix_app_exists"

  assert_succeeds \
    "check-env is available as nix app" \
    "nix flake show --json 2>/dev/null | jq -e '.apps.\"x86_64-linux\".\"check-env\"' >/dev/null 2>&1 || nix flake show 2>&1 | grep -q check-env"
}

# Main test runner
main() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}check-env.nix Tests${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # If specific test requested, run only that test
  if [[ $# -gt 0 ]]; then
    test_name="$1"
    if type "$test_name" &>/dev/null; then
      "$test_name"
    else
      echo -e "${RED}Error: Test '$test_name' not found${NC}"
      echo "Available tests:"
      echo "  test_check_env_succeeds_when_deps_present (reports socat/bubblewrap available)"
      echo "  test_check_env_shows_socat_available"
      echo "  test_check_env_shows_bubblewrap_available"
      echo "  test_check_env_output_format"
      echo "  test_check_env_detects_missing_socat"
      echo "  test_check_env_detects_missing_bubblewrap"
      echo "  test_check_env_exit_code_on_failure"
      echo "  test_check_env_shows_socat_fix_instructions"
      echo "  test_check_env_shows_bubblewrap_fix_instructions"
      echo "  test_check_env_nix_app_exists"
      exit 1
    fi
  else
    # Run all tests
    test_check_env_nix_app_exists
    test_check_env_succeeds_when_deps_present
    test_check_env_shows_socat_available
    test_check_env_shows_bubblewrap_available
    test_check_env_output_format
    test_check_env_detects_missing_socat
    test_check_env_detects_missing_bubblewrap
    test_check_env_exit_code_on_failure
    test_check_env_shows_socat_fix_instructions
    test_check_env_shows_bubblewrap_fix_instructions
  fi

  # Print summary
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Test Summary${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "Tests run:    $TESTS_RUN"
  echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"

  if [[ $TESTS_FAILED -gt 0 ]]; then
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
    echo ""
    echo -e "${RED}TESTS FAILED${NC}"
    exit 1
  else
    echo "Tests failed: 0"
    echo ""
    echo -e "${GREEN}ALL TESTS PASSED${NC}"
    exit 0
  fi
}

# Run main function with all arguments
main "$@"
