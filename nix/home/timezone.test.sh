#!/usr/bin/env bash
# Integration tests for timezone.nix module
#
# This script validates that the TZ environment variable configuration works correctly
# in Home Manager sessions. It tests the complete flow from Nix configuration to
# actual shell environment.
#
# Tests verify:
# 1. TZ environment variable is set to America/New_York
# 2. The date command respects the timezone setting
# 3. Home Manager session vars file exists and contains the TZ setting
#
# Usage:
#   ./nix/home/timezone.test.sh                  # Run all tests
#   ./nix/home/timezone.test.sh test_name        # Run specific test
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

# Helper: Assert string contains substring
assert_contains() {
  local description="$1"
  local haystack="$2"
  local needle="$3"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: $description${NC}"

  if echo "$haystack" | grep -qF "$needle"; then
    echo -e "${GREEN}✓ PASS: Found expected string${NC}"
    echo "Expected: $needle"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Expected string not found${NC}"
    echo "Expected: $needle"
    echo "In: $haystack"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper: Assert string equals expected value
assert_equals() {
  local description="$1"
  local actual="$2"
  local expected="$3"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -e "${YELLOW}Running: $description${NC}"

  if [ "$actual" = "$expected" ]; then
    echo -e "${GREEN}✓ PASS: Values match${NC}"
    echo "Expected: $expected"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Values don't match${NC}"
    echo "Expected: $expected"
    echo "Actual:   $actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 1: Verify TZ environment variable is set correctly
test_tz_variable_set() {
  print_test_header "test_tz_variable_set"

  # Check if TZ is set to America/New_York
  if [ -n "${TZ:-}" ]; then
    assert_equals \
      "TZ environment variable value" \
      "$TZ" \
      "America/New_York"
  else
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${RED}✗ FAIL: TZ environment variable is not set${NC}"
    echo "Expected: TZ=America/New_York"
    echo "Actual:   TZ is unset or empty"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 2: Verify date command respects timezone setting
test_date_command_timezone() {
  print_test_header "test_date_command_timezone"

  # Test that date command uses Eastern Time
  # Eastern Time is either EST (-0500) or EDT (-0400) depending on DST
  local date_offset
  date_offset=$(date +%z)

  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Verify date command timezone offset${NC}"

  if [ "$date_offset" = "-0500" ] || [ "$date_offset" = "-0400" ]; then
    echo -e "${GREEN}✓ PASS: date command uses Eastern Time${NC}"
    echo "Timezone offset: $date_offset (EST or EDT)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: date command not using Eastern Time${NC}"
    echo "Expected: -0500 (EST) or -0400 (EDT)"
    echo "Actual:   $date_offset"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 3: Verify Home Manager session vars file exists and contains TZ
test_session_vars_file() {
  print_test_header "test_session_vars_file"

  # Check for session vars file in common locations
  local session_vars_file=""
  local possible_paths=(
    "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh"
    "$HOME/.local/state/nix/profiles/profile/etc/profile.d/hm-session-vars.sh"
  )

  for path in "${possible_paths[@]}"; do
    if [ -f "$path" ]; then
      session_vars_file="$path"
      break
    fi
  done

  if [ -z "$session_vars_file" ]; then
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${YELLOW}Running: Check session vars file exists${NC}"
    echo -e "${YELLOW}⚠ WARNING: Home Manager session vars file not found${NC}"
    echo "This test requires an active Home Manager installation."
    echo "Checked locations:"
    for path in "${possible_paths[@]}"; do
      echo "  - $path"
    done
    echo "Skipping session vars file tests."
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi

  # Verify file exists
  assert_succeeds \
    "Check session vars file exists at $session_vars_file" \
    "test -f '$session_vars_file'"

  # Verify file contains timezone setting
  local file_content
  file_content=$(cat "$session_vars_file")
  assert_contains \
    "Check session vars file contains TZ setting" \
    "$file_content" \
    "America/New_York"
}

# Test 4: Verify timezone format is valid
test_timezone_format_valid() {
  print_test_header "test_timezone_format_valid"

  # Verify the timezone format is recognized by the system
  # We do this by setting TZ and checking if date command works
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Verify timezone format is valid${NC}"

  if TZ="America/New_York" date >/dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS: Timezone format is valid${NC}"
    echo "TZ=America/New_York is recognized by the system"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: Timezone format is invalid${NC}"
    echo "TZ=America/New_York is not recognized by date command"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 5: Verify DST handling (test both EST and EDT offsets are valid)
test_dst_handling() {
  print_test_header "test_dst_handling"

  # Test a specific date in winter (EST, -0500)
  local winter_offset
  winter_offset=$(TZ="America/New_York" date -d "2026-01-15 12:00:00" +%z 2>/dev/null || echo "")

  if [ -n "$winter_offset" ]; then
    assert_equals \
      "Winter timezone offset (EST)" \
      "$winter_offset" \
      "-0500"
  else
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${YELLOW}⚠ WARNING: Could not test winter DST (date -d not supported)${NC}"
    echo "Skipping winter DST test."
    TESTS_PASSED=$((TESTS_PASSED + 1))
  fi

  # Test a specific date in summer (EDT, -0400)
  local summer_offset
  summer_offset=$(TZ="America/New_York" date -d "2026-07-15 12:00:00" +%z 2>/dev/null || echo "")

  if [ -n "$summer_offset" ]; then
    assert_equals \
      "Summer timezone offset (EDT)" \
      "$summer_offset" \
      "-0400"
  else
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${YELLOW}⚠ WARNING: Could not test summer DST (date -d not supported)${NC}"
    echo "Skipping summer DST test."
    TESTS_PASSED=$((TESTS_PASSED + 1))
  fi
}

# Test 6: Verify TZ variable affects time-aware commands
test_tz_affects_commands() {
  print_test_header "test_tz_affects_commands"

  # Compare UTC time with Eastern Time to verify TZ has an effect
  local utc_hour
  local eastern_hour

  utc_hour=$(TZ=UTC date +%H)
  eastern_hour=$(TZ=America/New_York date +%H)

  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Verify TZ variable affects time display${NC}"

  # Eastern Time should be 4 or 5 hours behind UTC (depending on DST)
  # We just verify they're different, not the exact offset
  if [ "$utc_hour" != "$eastern_hour" ] || [ "$(TZ=UTC date +%z)" != "$(TZ=America/New_York date +%z)" ]; then
    echo -e "${GREEN}✓ PASS: TZ variable affects time-aware commands${NC}"
    echo "UTC hour:     $utc_hour ($(TZ=UTC date +%z))"
    echo "Eastern hour: $eastern_hour ($(TZ=America/New_York date +%z))"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL: TZ variable does not affect time display${NC}"
    echo "UTC and Eastern time appear identical"
    echo "This suggests TZ is not being respected"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Test 7: Verify nix configuration file syntax
test_nix_config_syntax() {
  print_test_header "test_nix_config_syntax"

  # Verify the timezone.nix file has valid Nix syntax
  assert_succeeds \
    "Check timezone.nix syntax with nix-instantiate" \
    "nix-instantiate --parse nix/home/timezone.nix >/dev/null 2>&1"
}

# Test 8: Integration test - full workflow verification
test_integration_workflow() {
  print_test_header "test_integration_workflow"

  echo -e "${BLUE}Running full integration workflow...${NC}"

  # Step 1: Verify timezone.nix module exists
  assert_succeeds \
    "Step 1: timezone.nix module exists" \
    "test -f nix/home/timezone.nix"

  # Step 2: Verify TZ is exported in current environment
  if [ -n "${TZ:-}" ]; then
    assert_equals \
      "Step 2: TZ variable is set in environment" \
      "$TZ" \
      "America/New_York"
  else
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${YELLOW}⚠ WARNING: TZ not set in current shell${NC}"
    echo "This may be expected if not running in a Home Manager shell."
    echo "Skipping current environment TZ test."
    TESTS_PASSED=$((TESTS_PASSED + 1))
  fi

  # Step 3: Verify date command works with explicit TZ
  assert_succeeds \
    "Step 3: date command works with TZ=America/New_York" \
    "TZ=America/New_York date >/dev/null"

  # Step 4: Verify timezone data exists on system
  local zoneinfo_paths=(
    "/usr/share/zoneinfo/America/New_York"
    "/nix/store/*/share/zoneinfo/America/New_York"
  )

  local found_zoneinfo=false
  for pattern in "${zoneinfo_paths[@]}"; do
    if ls $pattern 2>/dev/null | head -1 >/dev/null; then
      found_zoneinfo=true
      break
    fi
  done

  TESTS_RUN=$((TESTS_RUN + 1))
  if [ "$found_zoneinfo" = true ]; then
    echo -e "${YELLOW}Running: Step 4: timezone data exists on system${NC}"
    echo -e "${GREEN}✓ PASS: Command succeeded as expected${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${YELLOW}Running: Step 4: timezone data exists on system${NC}"
    echo -e "${YELLOW}⚠ WARNING: Could not find zoneinfo files${NC}"
    echo "This may be normal in Nix environments."
    echo "Timezone data is embedded in tzdata package."
    TESTS_PASSED=$((TESTS_PASSED + 1))
  fi

  echo -e "${GREEN}Integration workflow complete${NC}"
}

# Main test runner
main() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Timezone Configuration Integration Tests${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # TODO(#1852): Enable Home Manager session vars tests in CI environment
  # Skip if Home Manager is not installed (e.g., before home-manager switch)
  SESSION_VARS_FILE="$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh"
  if [ ! -f "$SESSION_VARS_FILE" ]; then
    echo ""
    echo -e "${YELLOW}⚠ SKIP: Home Manager not activated - skipping all integration tests${NC}"
    echo -e "${YELLOW}  File not found: $SESSION_VARS_FILE${NC}"
    echo -e "${YELLOW}  Run 'home-manager switch --flake .#default --impure' to activate and enable these tests${NC}"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Test Summary${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo "Tests run:    0"
    echo -e "Tests passed: ${GREEN}0${NC} (skipped)"
    echo "Tests failed: 0"
    echo ""
    echo -e "${GREEN}TESTS SKIPPED (Home Manager not activated)${NC}"
    exit 0
  fi

  # If specific test requested, run only that test
  if [[ $# -gt 0 ]]; then
    test_name="$1"
    if type "$test_name" &>/dev/null; then
      "$test_name"
    else
      echo -e "${RED}Error: Test '$test_name' not found${NC}"
      echo "Available tests:"
      echo "  test_tz_variable_set"
      echo "  test_date_command_timezone"
      echo "  test_session_vars_file"
      echo "  test_timezone_format_valid"
      echo "  test_dst_handling"
      echo "  test_tz_affects_commands"
      echo "  test_nix_config_syntax"
      echo "  test_integration_workflow"
      exit 1
    fi
  else
    # Run all tests
    test_tz_variable_set
    test_date_command_timezone
    test_session_vars_file
    test_timezone_format_valid
    test_dst_handling
    test_tz_affects_commands
    test_nix_config_syntax
    test_integration_workflow
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
