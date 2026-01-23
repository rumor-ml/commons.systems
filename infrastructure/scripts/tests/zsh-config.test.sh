#!/usr/bin/env bash
# Zsh configuration tests
#
# Validates that the zsh.nix configuration correctly:
# 1. Sources session variables in all zsh shells (via envExtra)
# 2. Makes TZ and other Home Manager variables available
# 3. Preserves existing configuration (prompt, direnv, vcs_info)
# 4. Loads without errors in interactive and non-interactive contexts
#
# Related files:
# - nix/home/zsh.nix: Zsh configuration with envExtra and initExtra
# - nix/home/timezone.nix: TZ variable definition
# - nix/home/bash.nix: Similar pattern for bash shell

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
# Zsh Configuration Tests
# ============================================================================

test_zsh_is_available() {
  if ! command -v zsh &> /dev/null; then
    test_fail "zsh is available" "zsh command not found in PATH"
    return
  fi

  test_pass "zsh is available"
}

test_zshenv_exists() {
  local zshenv="$HOME/.zshenv"

  if [ ! -f "$zshenv" ]; then
    test_fail ".zshenv exists" "File not found at $zshenv (Home Manager should create it)"
    return
  fi

  test_pass ".zshenv exists"
}

test_zshenv_sources_session_vars() {
  local zshenv="$HOME/.zshenv"

  if [ ! -f "$zshenv" ]; then
    test_fail ".zshenv sources session variables" ".zshenv not found"
    return
  fi

  # Check for session variable sourcing pattern
  # Looking for the file check and source pattern from envExtra
  if ! grep -q "hm-session-vars.sh" "$zshenv"; then
    test_fail ".zshenv sources session variables" "No reference to hm-session-vars.sh found"
    return
  fi

  # Verify it checks for file existence before sourcing
  if ! grep -q "if.*-f.*hm-session-vars.sh" "$zshenv"; then
    test_fail ".zshenv sources session variables" "Missing file existence check before sourcing"
    return
  fi

  test_pass ".zshenv sources session variables"
}

test_zshrc_exists() {
  local zshrc="$HOME/.zshrc"

  if [ ! -f "$zshrc" ]; then
    test_fail ".zshrc exists" "File not found at $zshrc (Home Manager should create it)"
    return
  fi

  test_pass ".zshrc exists"
}

test_zshrc_has_preserved_config() {
  local zshrc="$HOME/.zshrc"

  if [ ! -f "$zshrc" ]; then
    test_fail ".zshrc has preserved configuration" ".zshrc not found"
    return
  fi

  # Check for key preserved configuration elements from initExtra
  local missing_elements=()

  # Check for PROMPT_SUBST option (required for dynamic prompt)
  if ! grep -q "PROMPT_SUBST" "$zshrc"; then
    missing_elements+=("PROMPT_SUBST")
  fi

  # Check for vcs_info (git prompt integration)
  if ! grep -q "vcs_info" "$zshrc"; then
    missing_elements+=("vcs_info")
  fi

  # Check for bashcompinit (bash completion compatibility)
  if ! grep -q "bashcompinit" "$zshrc"; then
    missing_elements+=("bashcompinit")
  fi

  if [ ${#missing_elements[@]} -gt 0 ]; then
    test_fail ".zshrc has preserved configuration" "Missing elements: ${missing_elements[*]}"
    return
  fi

  test_pass ".zshrc has preserved configuration"
}

test_zsh_loads_without_errors() {
  if ! command -v zsh &> /dev/null; then
    test_fail "zsh loads without errors" "zsh not available"
    return
  fi

  # Try to load zsh and run a simple command
  local output
  local exit_code=0

  # Capture both stdout and stderr
  output=$(zsh -c 'echo "zsh_test_success"' 2>&1) || exit_code=$?

  if [ $exit_code -ne 0 ]; then
    test_fail "zsh loads without errors" "zsh exited with code $exit_code. Output: $output"
    return
  fi

  if ! echo "$output" | grep -q "zsh_test_success"; then
    test_fail "zsh loads without errors" "Expected output not found. Got: $output"
    return
  fi

  test_pass "zsh loads without errors"
}

test_zsh_interactive_loads_without_errors() {
  if ! command -v zsh &> /dev/null; then
    test_fail "zsh interactive shell loads without errors" "zsh not available"
    return
  fi

  # Test interactive shell startup with complex prompt configuration
  local output
  local exit_code=0

  # Use -i for interactive, but provide command to avoid hanging
  output=$(zsh -i -c 'echo "interactive_success"' 2>&1) || exit_code=$?

  if [ $exit_code -ne 0 ]; then
    test_fail "zsh interactive shell loads without errors" "zsh -i exited with code $exit_code. Output: $output"
    return
  fi

  if ! echo "$output" | grep -q "interactive_success"; then
    test_fail "zsh interactive shell loads without errors" "Expected output not found. Got: $output"
    return
  fi

  # Check for common error patterns that might indicate prompt issues
  if echo "$output" | grep -qi "parse error"; then
    test_fail "zsh interactive shell loads without errors" "Parse error detected in output: $output"
    return
  fi

  test_pass "zsh interactive shell loads without errors"
}

test_tz_available_in_zsh_noninteractive() {
  if ! command -v zsh &> /dev/null; then
    test_fail "TZ available in non-interactive zsh" "zsh not available"
    return
  fi

  # Test that TZ is available in non-interactive zsh (tests envExtra)
  local tz_value
  tz_value=$(zsh -c 'echo $TZ' 2>&1)

  if [ -z "$tz_value" ]; then
    test_fail "TZ available in non-interactive zsh" "TZ variable is empty (envExtra may not be working)"
    return
  fi

  # Verify it's the expected timezone from timezone.nix
  if [ "$tz_value" != "America/New_York" ]; then
    test_fail "TZ available in non-interactive zsh" "TZ=$tz_value, expected America/New_York"
    return
  fi

  test_pass "TZ available in non-interactive zsh"
}

test_tz_available_in_zsh_interactive() {
  if ! command -v zsh &> /dev/null; then
    test_fail "TZ available in interactive zsh" "zsh not available"
    return
  fi

  # Test that TZ is available in interactive zsh
  local tz_value
  tz_value=$(zsh -i -c 'echo $TZ' 2>&1 | tail -1)

  if [ -z "$tz_value" ]; then
    test_fail "TZ available in interactive zsh" "TZ variable is empty"
    return
  fi

  # Verify it's the expected timezone
  if [ "$tz_value" != "America/New_York" ]; then
    test_fail "TZ available in interactive zsh" "TZ=$tz_value, expected America/New_York"
    return
  fi

  test_pass "TZ available in interactive zsh"
}

test_zsh_prompt_variables_defined() {
  if ! command -v zsh &> /dev/null; then
    test_fail "zsh prompt variables are defined" "zsh not available"
    return
  fi

  # Verify that key prompt variables are defined (tests initExtra execution)
  local output
  output=$(zsh -i -c 'echo "HR=${HR:0:10}"; echo "PROMPT=${PROMPT:0:30}"' 2>&1)

  # Check that HR variable is defined (horizontal rule from initExtra)
  if ! echo "$output" | grep -q "HR="; then
    test_fail "zsh prompt variables are defined" "HR variable not found in output"
    return
  fi

  # Check that PROMPT variable is defined
  if ! echo "$output" | grep -q "PROMPT="; then
    test_fail "zsh prompt variables are defined" "PROMPT variable not found in output"
    return
  fi

  test_pass "zsh prompt variables are defined"
}

test_zsh_direnv_hook_conditional() {
  local zshrc="$HOME/.zshrc"

  if [ ! -f "$zshrc" ]; then
    test_fail "zsh direnv hook is conditional" ".zshrc not found"
    return
  fi

  # Verify direnv hook has conditional check (only loads if direnv is installed)
  if ! grep -q "command -v direnv" "$zshrc"; then
    test_fail "zsh direnv hook is conditional" "Missing 'command -v direnv' check"
    return
  fi

  # Verify the pattern is correct: if command -v direnv; then eval hook
  if ! grep -A 2 "command -v direnv" "$zshrc" | grep -q "direnv hook zsh"; then
    test_fail "zsh direnv hook is conditional" "direnv hook not properly conditional"
    return
  fi

  test_pass "zsh direnv hook is conditional"
}

test_zsh_config_nix_has_envinit_extra() {
  local zsh_nix="$REPO_ROOT/nix/home/zsh.nix"

  if [ ! -f "$zsh_nix" ]; then
    test_fail "zsh.nix has envExtra and initExtra" "zsh.nix not found at $zsh_nix"
    return
  fi

  # Verify both envExtra and initExtra are defined
  if ! grep -q "envExtra" "$zsh_nix"; then
    test_fail "zsh.nix has envExtra and initExtra" "envExtra not found in zsh.nix"
    return
  fi

  if ! grep -q "initExtra" "$zsh_nix"; then
    test_fail "zsh.nix has envExtra and initExtra" "initExtra not found in zsh.nix"
    return
  fi

  test_pass "zsh.nix has envExtra and initExtra"
}

test_zsh_config_endinextra_sources_session_vars() {
  local zsh_nix="$REPO_ROOT/nix/home/zsh.nix"

  if [ ! -f "$zsh_nix" ]; then
    test_fail "zsh.nix envExtra sources session variables" "zsh.nix not found"
    return
  fi

  # Extract envExtra section and verify it sources session variables
  local envinextra_content
  envinextra_content=$(awk '/envExtra[[:space:]]*=/{flag=1; next} flag && /'\'';/{flag=0} flag' "$zsh_nix")

  if [ -z "$envinextra_content" ]; then
    test_fail "zsh.nix envExtra sources session variables" "Could not extract envExtra content"
    return
  fi

  # Verify it references hm-session-vars.sh
  if ! echo "$envinextra_content" | grep -q "hm-session-vars.sh"; then
    test_fail "zsh.nix envExtra sources session variables" "envExtra doesn't reference hm-session-vars.sh"
    return
  fi

  # Verify it has a file existence check
  if ! echo "$envinextra_content" | grep -q "\-f"; then
    test_fail "zsh.nix envExtra sources session variables" "envExtra missing file existence check"
    return
  fi

  test_pass "zsh.nix envExtra sources session variables"
}

test_zsh_complex_prompt_string_escaping() {
  local zshrc="$HOME/.zshrc"

  if [ ! -f "$zshrc" ]; then
    test_fail "zsh complex prompt string escaping" ".zshrc not found"
    return
  fi

  # Verify the complex string escaping from initExtra is present
  # Looking for the HR variable with zsh parameter expansion: ${(r:$COLUMNS::_:)}
  # This pattern uses zsh-specific syntax that requires careful escaping in Nix
  if ! grep -q '\${(r:\$COLUMNS::_:)}' "$zshrc"; then
    test_fail "zsh complex prompt string escaping" "Complex prompt string escaping not found (HR variable)"
    return
  fi

  test_pass "zsh complex prompt string escaping"
}

# ============================================================================
# Run All Tests
# ============================================================================

echo "========================================"
echo "Zsh Configuration Tests"
echo "========================================"

run_test test_zsh_is_available
run_test test_zshenv_exists
run_test test_zshenv_sources_session_vars
run_test test_zshrc_exists
run_test test_zshrc_has_preserved_config
run_test test_zsh_loads_without_errors
run_test test_zsh_interactive_loads_without_errors
run_test test_tz_available_in_zsh_noninteractive
run_test test_tz_available_in_zsh_interactive
run_test test_zsh_prompt_variables_defined
run_test test_zsh_direnv_hook_conditional
run_test test_zsh_config_nix_has_envinit_extra
run_test test_zsh_config_endinextra_sources_session_vars
run_test test_zsh_complex_prompt_string_escaping

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
