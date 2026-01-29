#!/usr/bin/env bash
# TODO(#1599): Add negative test cases for sandbox dependency failures
# Integration tests for Claude Code sandbox dependencies
#
# This script validates that socat and bubblewrap packages are available
# in the Nix environment, which are required for Claude Code sandbox functionality.
#
# Background:
# Claude Code's sandbox feature requires two system dependencies:
# - socat: Socket relay for sandbox communication
# - bubblewrap (bwrap): Unprivileged Linux sandboxing tool
#
# Usage:
#   ./nix/sandbox-dependencies.test.sh           # Run all tests
#   ./nix/sandbox-dependencies.test.sh test_name # Run specific test
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed

set -euo pipefail

# TODO(#1592): Extract shared test helper functions to nix/lib/test-helpers.sh
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

# Platform detection
PLATFORM="$(uname -s)"
IS_LINUX=false
if [[ "$PLATFORM" == "Linux" ]]; then
  IS_LINUX=true
fi

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
# TODO(#1606): Test helper functions eval untrusted input without validation
assert_succeeds() {
  local description="$1"
  local command="$2"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: $description${NC}"

  if output=$(eval "$command" 2>&1); then
    echo -e "${GREEN}✓ PASS: Command succeeded as expected${NC}"
    if [[ -n "$output" ]]; then
      echo "Output: $output"
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
# TODO(#1606): Test helper functions eval untrusted input without validation
assert_output_contains() {
  local description="$1"
  local command="$2"
  local expected_string="$3"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: $description${NC}"

  if output=$(eval "$command" 2>&1); then
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
  else
    echo -e "${RED}✗ FAIL: Command failed${NC}"
    echo "Command: $command"
    echo "Output: $output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 1: Verify socat is available in PATH
test_socat_available() {
  print_test_header "test_socat_available"

  assert_succeeds \
    "socat binary is available" \
    "which socat"
}

# Test 2: Verify bubblewrap is available in PATH
test_bubblewrap_available() {
  print_test_header "test_bubblewrap_available"

  # Skip on non-Linux platforms
  if [[ "$IS_LINUX" != "true" ]]; then
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${YELLOW}⏭️  SKIPPED: bubblewrap is Linux-only${NC}"
    return 0
  fi

  assert_succeeds \
    "bubblewrap binary is available" \
    "which bwrap"
}

# Test 3: Verify socat version command works
test_socat_version() {
  print_test_header "test_socat_version"

  assert_output_contains \
    "socat reports version information" \
    "socat -V 2>&1" \
    "socat version"
}

# Test 4: Verify bubblewrap version command works
test_bubblewrap_version() {
  print_test_header "test_bubblewrap_version"

  # Skip on non-Linux platforms
  if [[ "$IS_LINUX" != "true" ]]; then
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${YELLOW}⏭️  SKIPPED: bubblewrap is Linux-only${NC}"
    return 0
  fi

  assert_output_contains \
    "bubblewrap reports version information" \
    "bwrap --version" \
    "bubblewrap"
}

# Test 5: Verify socat is declared in flake.nix
test_socat_in_flake() {
  print_test_header "test_socat_in_flake"

  assert_output_contains \
    "socat is declared in flake.nix" \
    "grep -n 'socat' flake.nix" \
    "socat"
}

# Test 6: Verify bubblewrap is declared in flake.nix
test_bubblewrap_in_flake() {
  print_test_header "test_bubblewrap_in_flake"

  assert_output_contains \
    "bubblewrap is declared in flake.nix" \
    "grep -n 'bubblewrap' flake.nix" \
    "bubblewrap"
}

# Test 7: Verify socat basic functionality
test_socat_basic_functionality() {
  print_test_header "test_socat_basic_functionality"

  # Test that socat can show help without errors
  assert_succeeds \
    "socat shows help text" \
    "socat -h 2>&1 | head -1"
}

# Test 8: Verify bubblewrap basic functionality
# TODO(#1597): Consider testing with minimal mounts (--dev /dev --proc /proc --tmpfs /tmp) for better portability
# TODO(#1603): Test suite uses overly complex bubblewrap invocation that may fail on some systems
test_bubblewrap_basic_functionality() {
  print_test_header "test_bubblewrap_basic_functionality"

  # TODO(#1646): Skip in GitHub Actions - CI environment lacks CAP_NET_ADMIN for network namespaces
  if [[ "${GITHUB_ACTIONS:-false}" == "true" ]]; then
    echo -e "${YELLOW}⚠ SKIP: Test requires CAP_NET_ADMIN not available in GitHub Actions${NC}"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi

  # Skip on non-Linux platforms
  if [[ "$IS_LINUX" != "true" ]]; then
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${YELLOW}⏭️  SKIPPED: bubblewrap is Linux-only${NC}"
    return 0
  fi

  # Test that bubblewrap can execute a simple command
  # Using minimal bind mounts that should work on most Linux systems
  assert_succeeds \
    "bubblewrap can execute simple command" \
    "bwrap --ro-bind / / --proc /proc --dev /dev --unshare-all --die-with-parent echo 'sandbox test'"
}

# Test 9: Verify Claude Code settings.json sandbox configuration exists
test_claude_settings_sandbox_enabled() {
  print_test_header "test_claude_settings_sandbox_enabled"

  # Check that claude-code.nix exists and configures settings
  assert_succeeds \
    "claude-code.nix exists with settings configuration" \
    "grep -q 'settings.json' nix/home/claude-code.nix"
}

# Test 10: Verify flake.nix documents sandbox dependencies
test_flake_documents_sandbox() {
  print_test_header "test_flake_documents_sandbox"

  # Check that flake.nix has comments documenting sandbox dependencies
  assert_output_contains \
    "flake.nix documents sandbox dependencies" \
    "grep -B 2 'socat' flake.nix" \
    "Sandbox"
}

# Test 11: Integration test - verify both dependencies work together
test_sandbox_dependencies_integration() {
  print_test_header "test_sandbox_dependencies_integration"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: Verify sandbox dependencies for current platform${NC}"

  # Check socat (required on all platforms)
  if ! which socat >/dev/null 2>&1; then
    echo -e "${RED}✗ FAIL: socat is missing (required on all platforms)${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  # Check bwrap (Linux only)
  if [[ "$IS_LINUX" == "true" ]]; then
    if ! which bwrap >/dev/null 2>&1; then
      echo -e "${RED}✗ FAIL: bubblewrap is missing (required on Linux)${NC}"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      return 1
    fi
    echo -e "${GREEN}✓ PASS: All sandbox dependencies available (Linux)${NC}"
    echo "  socat: $(which socat)"
    echo "  bwrap: $(which bwrap)"
  else
    echo -e "${GREEN}✓ PASS: All sandbox dependencies available ($PLATFORM)${NC}"
    echo "  socat: $(which socat)"
    echo "  bwrap: skipped (Linux-only)"
  fi

  TESTS_PASSED=$((TESTS_PASSED + 1))
  return 0
}

# Test 12: Verify home-manager claude-code module exists
test_home_manager_claude_module() {
  print_test_header "test_home_manager_claude_module"

  assert_succeeds \
    "claude-code.nix home-manager module exists" \
    "test -f nix/home/claude-code.nix"
}

# Test 13: Smoke test - verify environment is in nix shell
test_nix_shell_environment() {
  print_test_header "test_nix_shell_environment"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: Verify we are in nix development environment${NC}"

  # Check if NIX_PATH or other nix variables are set
  # This is a soft check - if not in nix shell, tests might fail but that's informative
  if [[ -n "${IN_NIX_SHELL:-}" ]] || [[ -n "${NIX_PATH:-}" ]]; then
    echo -e "${GREEN}✓ PASS: Running in Nix shell environment${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${YELLOW}⚠ WARNING: Not running in Nix shell environment${NC}"
    echo "  These tests assume 'nix develop' shell is active"
    echo "  Run 'nix develop' before running tests for accurate results"
    # Don't fail the test, just warn
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi
}

# Main test runner
main() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Claude Code Sandbox Dependencies Tests${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # If specific test requested, run only that test
  if [[ $# -gt 0 ]]; then
    test_name="$1"
    if type "$test_name" &>/dev/null; then
      "$test_name"
    else
      echo -e "${RED}Error: Test '$test_name' not found${NC}"
      echo "Available tests:"
      echo "  test_socat_available"
      echo "  test_bubblewrap_available"
      echo "  test_socat_version"
      echo "  test_bubblewrap_version"
      echo "  test_socat_in_flake"
      echo "  test_bubblewrap_in_flake"
      echo "  test_socat_basic_functionality"
      echo "  test_bubblewrap_basic_functionality"
      echo "  test_claude_settings_sandbox_enabled"
      echo "  test_flake_documents_sandbox"
      echo "  test_sandbox_dependencies_integration"
      echo "  test_home_manager_claude_module"
      echo "  test_nix_shell_environment"
      exit 1
    fi
  else
    # Run all tests
    test_nix_shell_environment
    test_socat_available
    test_bubblewrap_available
    test_socat_version
    test_bubblewrap_version
    test_socat_in_flake
    test_bubblewrap_in_flake
    test_socat_basic_functionality
    test_bubblewrap_basic_functionality
    test_claude_settings_sandbox_enabled
    test_flake_documents_sandbox
    test_sandbox_dependencies_integration
    test_home_manager_claude_module
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
