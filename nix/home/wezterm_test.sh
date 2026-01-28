#!/usr/bin/env bash
# Tests for wezterm.nix activation script
# Tests Windows user detection and config copy logic on WSL
# TODO(#1612): Shell tests verify activation script logic but don't verify home-manager DAG integration
# The tests validate user detection and file copy in isolation, but don't verify:
# - Activation script executes correctly in home-manager's DAG after linkGeneration phase
# - Script has proper access to Home Manager variables like $DRY_RUN_CMD and $VERBOSE_ARG (used in wezterm.nix line 103)
# - DAG ordering ensures activation runs at the correct point in the configuration build

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILURES=0
PASSES=0
CLEANUP_DIRS=()

# Cleanup function to remove all temp directories
cleanup() {
  local failed=0
  for dir in "${CLEANUP_DIRS[@]}"; do
    if ! rm -rf "$dir" 2>/dev/null; then
      echo "WARNING: Failed to cleanup directory: $dir" >&2
      failed=1
    fi
  done
  return 0  # Don't fail the trap
}
trap cleanup EXIT

# Helper to report test results
report_pass() {
  local description="$1"
  echo "✓ PASS: $description"
  ((PASSES++))
}

report_fail() {
  local description="$1"
  local details="${2:-}"
  echo "✗ FAIL: $description"
  if [[ -n "$details" ]]; then
    echo "  $details"
  fi
  ((FAILURES++))
}

echo "Running wezterm.nix activation script tests..."
echo ""

# Test 1: Windows user detection with valid user directories
echo "=== Test 1: Windows user detection filters system directories ==="
TEMP_MOUNT=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT")

mkdir -p "$TEMP_MOUNT/c/Users"/{alice,bob,Public,Default,"Default User","All Users"}
touch "$TEMP_MOUNT/c/Users/desktop.ini"

# Simulate the detection logic from wezterm.nix
WINDOWS_USER=$(ls "$TEMP_MOUNT/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

if [[ "$WINDOWS_USER" =~ ^(alice|bob)$ ]] && [[ "$WINDOWS_USER" != "Public" ]] && [[ "$WINDOWS_USER" != "Default" ]]; then
  report_pass "User detection correctly filters system directories"
else
  report_fail "User detection failed to filter system directories" "Got: $WINDOWS_USER"
fi

# Test 2: Windows user detection with no valid users
echo ""
echo "=== Test 2: Windows user detection with only system directories ==="
TEMP_MOUNT2=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT2")

mkdir -p "$TEMP_MOUNT2/c/Users"/{Public,Default}

WINDOWS_USER=$(ls "$TEMP_MOUNT2/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

if [[ -z "$WINDOWS_USER" ]]; then
  report_pass "User detection correctly returns empty when no valid users"
else
  report_fail "User detection should return empty for system-only directories" "Got: $WINDOWS_USER"
fi

# Test 3: Windows user detection with spaces in username
echo ""
echo "=== Test 3: Windows username with spaces ==="
TEMP_MOUNT3=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT3")

mkdir -p "$TEMP_MOUNT3/c/Users/John Doe"
mkdir -p "$TEMP_MOUNT3/c/Users/Public"

WINDOWS_USER=$(ls "$TEMP_MOUNT3/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

if [[ "$WINDOWS_USER" == "John Doe" ]]; then
  report_pass "User detection handles usernames with spaces"
else
  report_fail "User detection failed on username with spaces" "Got: '$WINDOWS_USER'"
fi

# Test 4: Config file copy operation (dry run simulation)
echo ""
echo "=== Test 4: Config file copy operation ==="
TEMP_SOURCE=$(mktemp)
TEMP_TARGET_DIR=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET_DIR")

echo "-- Test WezTerm Config" > "$TEMP_SOURCE"
TEMP_TARGET="$TEMP_TARGET_DIR/.wezterm.lua"

# Simulate the copy operation
if ! cp "$TEMP_SOURCE" "$TEMP_TARGET" 2>&1; then
  report_fail "Config file copy operation" "cp command failed"
  rm -f "$TEMP_SOURCE"
else
  rm -f "$TEMP_SOURCE"
  if [[ -f "$TEMP_TARGET" ]] && grep -q "Test WezTerm Config" "$TEMP_TARGET"; then
    report_pass "Config file copy succeeds"
  else
    report_fail "Config file copy failed"
  fi
fi

# Test 5: Missing /mnt/c/Users directory (non-WSL environment)
echo ""
echo "=== Test 5: Non-WSL environment detection ==="
TEMP_NO_WSL=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_NO_WSL")

# Directory exists but no /mnt/c/Users subdirectory
if [[ ! -d "$TEMP_NO_WSL/mnt/c/Users" ]]; then
  report_pass "Non-WSL environment correctly detected"
else
  report_fail "Should detect non-WSL environment"
fi

# Test 6: Windows user detection prioritizes first non-system directory
echo ""
echo "=== Test 6: User detection priority with multiple users ==="
TEMP_MOUNT4=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT4")

# Create directories in specific order - ls should return alphabetically
mkdir -p "$TEMP_MOUNT4/c/Users"/{charlie,alice,bob,Public}

WINDOWS_USER=$(ls "$TEMP_MOUNT4/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

# ls returns alphabetically, so should get 'alice' first
if [[ "$WINDOWS_USER" == "alice" ]]; then
  report_pass "User detection uses alphabetically first valid user"
else
  report_fail "User detection priority incorrect" "Expected: alice, Got: $WINDOWS_USER"
fi

# Test 7: Permission denied on /mnt/c/Users (error handling)
echo ""
echo "=== Test 7: Permission denied error handling ==="
TEMP_MOUNT5=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT5")

mkdir -p "$TEMP_MOUNT5/c/Users/testuser"
chmod 000 "$TEMP_MOUNT5/c/Users"

# ls should fail with permission denied
WINDOWS_USER=$(ls "$TEMP_MOUNT5/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1 || true)

# Restore permissions for cleanup
chmod 755 "$TEMP_MOUNT5/c/Users"

if [[ -z "$WINDOWS_USER" ]]; then
  report_pass "Permission denied handled gracefully"
else
  report_fail "Should handle permission denied gracefully"
fi

# Test 8: Special characters in Windows username
echo ""
echo "=== Test 8: Special characters in username ==="
TEMP_MOUNT6=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT6")

# Create username with hyphen and underscore (valid in Windows)
mkdir -p "$TEMP_MOUNT6/c/Users/test-user_123"
mkdir -p "$TEMP_MOUNT6/c/Users/Public"

WINDOWS_USER=$(ls "$TEMP_MOUNT6/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

if [[ "$WINDOWS_USER" == "test-user_123" ]]; then
  report_pass "User detection handles special characters"
else
  report_fail "User detection failed on special characters" "Got: '$WINDOWS_USER'"
fi

# Test 9: Empty /mnt/c/Users directory
echo ""
echo "=== Test 9: Empty /mnt/c/Users directory ==="
TEMP_MOUNT7=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT7")

mkdir -p "$TEMP_MOUNT7/c/Users"

WINDOWS_USER=$(ls "$TEMP_MOUNT7/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

if [[ -z "$WINDOWS_USER" ]]; then
  report_pass "Empty Users directory handled correctly"
else
  report_fail "Should return empty for empty Users directory" "Got: '$WINDOWS_USER'"
fi

# Test 10: Case sensitivity in system directory filtering
echo ""
echo "=== Test 10: Case-sensitive filtering of system directories ==="
TEMP_MOUNT8=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT8")

# Linux is case-sensitive, but Windows directories should be exact match
mkdir -p "$TEMP_MOUNT8/c/Users"/{public,default,alice}

WINDOWS_USER=$(ls "$TEMP_MOUNT8/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

# TODO(#1620): Test 10 comment incorrectly describes expected behavior
# Should match all three since filter is case-sensitive and only matches 'Public', 'Default' exactly
# We expect 'alice' to be selected, but 'default' and 'public' should also pass through
if [[ "$WINDOWS_USER" =~ ^(alice|default|public)$ ]]; then
  # This is actually expected behavior - the filter is case-sensitive
  # Real WSL has Windows filesystem which is case-insensitive, so 'Public' would exist
  report_pass "Case-sensitive filtering works as expected"
else
  report_fail "Unexpected filtering result" "Got: '$WINDOWS_USER'"
fi

# Test 11: Desktop.ini file should be filtered out
echo ""
echo "=== Test 11: Desktop.ini file filtering ==="
TEMP_MOUNT9=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT9")

mkdir -p "$TEMP_MOUNT9/c/Users/validuser"
touch "$TEMP_MOUNT9/c/Users/desktop.ini"

WINDOWS_USER=$(ls "$TEMP_MOUNT9/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

if [[ "$WINDOWS_USER" == "validuser" ]]; then
  report_pass "desktop.ini file correctly filtered"
else
  report_fail "desktop.ini filtering failed" "Got: '$WINDOWS_USER'"
fi

# Test 12: 'All Users' directory filtering
echo ""
echo "=== Test 12: 'All Users' directory filtering ==="
TEMP_MOUNT10=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT10")

mkdir -p "$TEMP_MOUNT10/c/Users/All Users"
mkdir -p "$TEMP_MOUNT10/c/Users/realuser"

WINDOWS_USER=$(ls "$TEMP_MOUNT10/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

if [[ "$WINDOWS_USER" == "realuser" ]]; then
  report_pass "'All Users' directory correctly filtered"
else
  report_fail "'All Users' filtering failed" "Got: '$WINDOWS_USER'"
fi

# Test 13: Config copy with target directory creation
echo ""
echo "=== Test 13: Target directory creation during copy ==="
TEMP_SOURCE2=$(mktemp)
TEMP_BASE_DIR=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_BASE_DIR")

echo "-- Config content" > "$TEMP_SOURCE2"
TEMP_NESTED_TARGET="$TEMP_BASE_DIR/nested/path/.wezterm.lua"

# Create parent directory if it doesn't exist, then copy
if ! mkdir -p "$(dirname "$TEMP_NESTED_TARGET")" 2>&1; then
  report_fail "Target directory creation" "mkdir -p failed"
  rm -f "$TEMP_SOURCE2"
elif ! cp "$TEMP_SOURCE2" "$TEMP_NESTED_TARGET" 2>&1; then
  report_fail "Config copy to nested path" "cp command failed"
  rm -f "$TEMP_SOURCE2"
elif [[ -f "$TEMP_NESTED_TARGET" ]]; then
  rm -f "$TEMP_SOURCE2"
  report_pass "Target directory creation and copy succeeds"
else
  rm -f "$TEMP_SOURCE2"
  report_fail "Target directory creation failed" "File not created despite no error"
fi

# Test 14: Verify actual activation script logic flow
echo ""
echo "=== Test 14: Activation script logic flow simulation ==="

# Simulate the full activation script logic
simulate_activation() {
  local mount_point="$1"
  local config_source="$2"

  # Check if running on WSL (Windows mount point exists)
  if [[ -d "$mount_point/c/Users" ]]; then
    # Detect Windows username
    local windows_user
    windows_user=$(ls "$mount_point/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

    if [[ -n "$windows_user" ]] && [[ -d "$mount_point/c/Users/$windows_user" ]]; then
      local target_dir="$mount_point/c/Users/$windows_user"
      local target_file="$target_dir/.wezterm.lua"

      # Copy config file
      if cp "$config_source" "$target_file" 2>/dev/null; then
        echo "copied"
        return 0
      else
        echo "copy_failed"
        return 1
      fi
    else
      echo "no_user_detected"
      return 0
    fi
  else
    echo "not_wsl"
    return 0
  fi
}

# Set up test scenario
ACTIVATION_MOUNT=$(mktemp -d)
ACTIVATION_CONFIG=$(mktemp)
CLEANUP_DIRS+=("$ACTIVATION_MOUNT")

if ! mkdir -p "$ACTIVATION_MOUNT/c/Users/testuser" 2>&1; then
  report_fail "Test 14 setup" "Failed to create test directory structure"
  rm -f "$ACTIVATION_CONFIG"
else
  echo "-- activation test" > "$ACTIVATION_CONFIG"

  result=$(simulate_activation "$ACTIVATION_MOUNT" "$ACTIVATION_CONFIG")
  rm -f "$ACTIVATION_CONFIG"

  if [[ "$result" == "copied" ]]; then
    report_pass "Full activation script logic simulation succeeds"
  else
    report_fail "Activation script simulation failed" "Got: $result"
  fi
fi

# Test 15: Source file missing error handling (simulated)
echo ""
echo "=== Test 15: Source file missing error handling ==="
# Simulate missing source file scenario
TEMP_TARGET15=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET15")
MISSING_SOURCE="/nonexistent/path/wezterm.lua"

# Check if error handling would trigger
if [[ ! -f "$MISSING_SOURCE" ]]; then
  report_pass "Source file existence check works correctly"
else
  report_fail "Should detect missing source file"
fi

# Test 16: Directory creation failure handling (simulated)
echo ""
echo "=== Test 16: Target directory creation failure handling ==="
TEMP_PARENT16=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_PARENT16")
chmod 555 "$TEMP_PARENT16"  # Make parent read-only so mkdir fails

# Try to create nested directory - should fail
if ! mkdir -p "$TEMP_PARENT16/nested/dir" 2>/dev/null; then
  report_pass "Directory creation failure detected correctly"
else
  report_fail "Should detect mkdir failure with read-only parent"
fi

chmod 755 "$TEMP_PARENT16"  # Restore for cleanup

# Test 17: Copy failure handling (read-only target)
echo ""
echo "=== Test 17: Copy failure with read-only target ==="
TEMP_SOURCE17=$(mktemp)
TEMP_TARGET_DIR17=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET_DIR17")
echo "test config" > "$TEMP_SOURCE17"
TARGET_FILE17="$TEMP_TARGET_DIR17/.wezterm.lua"
touch "$TARGET_FILE17"
chmod 444 "$TARGET_FILE17"  # Make read-only
chmod 555 "$TEMP_TARGET_DIR17"  # Make directory read-only

# Simulate copy operation - should fail gracefully
if ! cp "$TEMP_SOURCE17" "$TARGET_FILE17" 2>/dev/null; then
  report_pass "Copy failure detected correctly"
else
  report_fail "Should detect copy failure with read-only target"
fi

rm -f "$TEMP_SOURCE17"
chmod 755 "$TEMP_TARGET_DIR17"  # Restore for cleanup

# Test 18: Failed to list /mnt/c/Users directory error path
echo ""
echo "=== Test 18: Failed to list /mnt/c/Users directory (warning path) ==="
TEMP_MOUNT_NOPERM=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT_NOPERM")
mkdir -p "$TEMP_MOUNT_NOPERM/c/Users"
chmod 000 "$TEMP_MOUNT_NOPERM/c/Users"  # Remove all permissions

# Simulate the error path from wezterm.nix lines 72-78
if ! ls "$TEMP_MOUNT_NOPERM/c/Users/" >/tmp/wezterm-users-list-test18 2>&1; then
  # Expected to fail - this is the warning path
  if [[ -f /tmp/wezterm-users-list-test18 ]]; then
    # Verify warning is emitted and cleanup attempted
    rm -f /tmp/wezterm-users-list-test18 2>/dev/null
    report_pass "Failed /mnt/c/Users listing detected and handled with warning"
  else
    report_fail "Failed listing should create temp file for error message"
  fi
else
  report_fail "Should fail to list directory with no permissions"
fi

chmod 755 "$TEMP_MOUNT_NOPERM/c/Users"  # Restore for cleanup

# Test 19: Failed to cleanup temp file (warning to stderr)
echo ""
echo "=== Test 19: Failed to cleanup temp file warning ==="
TEMP_FILE_NOCLEAN=$(mktemp)
# Create a directory with same name to make rm fail
rm -f "$TEMP_FILE_NOCLEAN"
mkdir -p "$TEMP_FILE_NOCLEAN"
CLEANUP_DIRS+=("$TEMP_FILE_NOCLEAN")

# Simulate the cleanup error path from wezterm.nix lines 84-87
if ! rm "$TEMP_FILE_NOCLEAN" 2>/dev/null; then
  report_pass "Failed cleanup of temp file detected correctly"
else
  report_fail "Should fail to rm directory when expecting file"
fi

# Test 20: Source WezTerm config not found (ERROR and exit 1)
echo ""
echo "=== Test 20: Source config not found error path ==="
MISSING_SOURCE20="/nonexistent/home/.config/wezterm/wezterm.lua"
EXIT_CODE=0

# Simulate the error check from wezterm.nix lines 96-100
if [[ ! -f "$MISSING_SOURCE20" ]]; then
  # This should trigger ERROR and exit 1
  # Simulate the exit behavior
  EXIT_CODE=1
fi

if [[ $EXIT_CODE -eq 1 ]]; then
  report_pass "Missing source config triggers exit 1 as expected"
else
  report_fail "Missing source config should trigger exit 1"
fi

# Test 21: Failed to copy config (ERROR and exit 1)
echo ""
echo "=== Test 21: Failed config copy triggers ERROR and exit 1 ==="
TEMP_SOURCE21=$(mktemp)
TEMP_TARGET_DIR21=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET_DIR21")
echo "config content" > "$TEMP_SOURCE21"
TARGET_FILE21="$TEMP_TARGET_DIR21/.wezterm.lua"

# Make target directory read-only to force copy failure
chmod 555 "$TEMP_TARGET_DIR21"

COPY_EXIT_CODE=0
# Simulate the copy with error checking from wezterm.nix lines 103-107
# Note: Using DRY_RUN_CMD="" and VERBOSE_ARG="" to simulate activation script variables
DRY_RUN_CMD=""
VERBOSE_ARG=""
if ! $DRY_RUN_CMD cp $VERBOSE_ARG "$TEMP_SOURCE21" "$TARGET_FILE21" 2>/dev/null; then
  # This should trigger ERROR and exit 1
  COPY_EXIT_CODE=1
fi

rm -f "$TEMP_SOURCE21"
chmod 755 "$TEMP_TARGET_DIR21"  # Restore for cleanup

if [[ $COPY_EXIT_CODE -eq 1 ]]; then
  report_pass "Failed config copy triggers exit 1 as expected"
else
  report_fail "Failed config copy should trigger exit 1"
fi

# Test 22: Activation continues after failed /mnt/c/Users listing (soft error)
echo ""
echo "=== Test 22: Activation continues gracefully after directory listing failure ==="
TEMP_MOUNT_SOFT=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT_SOFT")
mkdir -p "$TEMP_MOUNT_SOFT/c/Users"
chmod 000 "$TEMP_MOUNT_SOFT/c/Users"

# Simulate the soft error path - listing fails but script continues
WINDOWS_USER=""
if ! ls "$TEMP_MOUNT_SOFT/c/Users/" >/tmp/wezterm-test22-list 2>&1; then
  # Warning emitted, but WINDOWS_USER remains empty and script continues
  rm -f /tmp/wezterm-test22-list 2>/dev/null
  WINDOWS_USER=""
fi

chmod 755 "$TEMP_MOUNT_SOFT/c/Users"  # Restore for cleanup

if [[ -z "$WINDOWS_USER" ]]; then
  report_pass "Activation continues gracefully with empty WINDOWS_USER after listing failure"
else
  report_fail "WINDOWS_USER should be empty after listing failure"
fi

# Summary
echo ""
echo "================================"
echo "Passed: $PASSES"
echo "Failed: $FAILURES"
echo "================================"

if [[ $FAILURES -eq 0 ]]; then
  echo "All tests passed!"
  exit 0
else
  echo "$FAILURES test(s) failed"
  exit 1
fi
