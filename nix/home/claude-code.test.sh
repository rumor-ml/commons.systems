#!/usr/bin/env bash
# Integration tests for claude-code.nix Home Manager configuration
#
# This script tests that the Home Manager configuration correctly installs
# the Claude Code package without deploying any configuration files.
#
# Usage:
#   ./nix/home/claude-code.test.sh                  # Run all tests
#   ./nix/home/claude-code.test.sh test_name        # Run specific test
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
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

# Helper: Assert command fails with expected error message
assert_fails_with_message() {
  local description="$1"
  local command="$2"
  local expected_message="$3"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: $description${NC}"

  # Run command and capture output
  if output=$(eval "$command" 2>&1); then
    echo -e "${RED}✗ FAIL: Command should have failed but succeeded${NC}"
    echo "Command: $command"
    echo "Output: $output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  # Check if output contains expected message
  if echo "$output" | grep -qF "$expected_message"; then
    echo -e "${GREEN}✓ PASS: Command failed with expected error${NC}"
    echo "Expected message found: $expected_message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Error message doesn't match${NC}"
    echo "Expected: $expected_message"
    echo "Got: $output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 1: Verify claude-code.nix has valid syntax
test_nix_syntax_is_valid() {
  print_test_header "test_nix_syntax_is_valid"

  assert_succeeds \
    "claude-code.nix has valid Nix syntax" \
    "nix-instantiate --parse nix/home/claude-code.nix > /dev/null"
}

# Test 2: Verify module structure is valid
test_module_structure_is_valid() {
  print_test_header "test_module_structure_is_valid"

  # Check that the module file has the expected attribute structure
  local has_home_packages=$(grep -c 'home\.packages' nix/home/claude-code.nix || true)

  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Verify module has home.packages attribute${NC}"

  if [ "$has_home_packages" -gt 0 ]; then
    echo -e "${GREEN}✓ PASS: Module contains home.packages${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Module missing home.packages attribute${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# Test 3: Verify module does not deploy settings.json
test_no_settings_json_deployed() {
  print_test_header "test_no_settings_json_deployed"

  # Parse the claude-code.nix file to check for xdg.configFile settings
  local has_settings=$(grep -c 'xdg.configFile.*settings.json' nix/home/claude-code.nix || true)

  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Verify module does not deploy settings.json${NC}"

  if [ "$has_settings" -eq 0 ]; then
    echo -e "${GREEN}✓ PASS: No settings.json deployment found${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Module still contains settings.json deployment${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# Main test runner
main() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Claude Code Home Manager Configuration Tests${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # If specific test requested, run only that test
  if [[ $# -gt 0 ]]; then
    test_name="$1"
    if type "$test_name" &>/dev/null; then
      "$test_name"
    else
      echo -e "${RED}Error: Test '$test_name' not found${NC}"
      echo "Available tests:"
      echo "  test_nix_syntax_is_valid"
      echo "  test_module_structure_is_valid"
      echo "  test_no_settings_json_deployed"
      exit 1
    fi
  else
    # Run all tests
    test_nix_syntax_is_valid
    test_module_structure_is_valid
    test_no_settings_json_deployed
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
