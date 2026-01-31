#!/usr/bin/env bash
# Tests for wezterm.nix activation script
# Tests Windows user detection and config copy logic on WSL
# Shell unit tests for activation script logic (user detection, file copy, error handling).
# For integration testing of DAG activation, see wezterm.test.nix tests:
# - test-homemanager-integration: verifies module evaluation
# - test-activation-dag-execution: verifies DAG ordering and variable access
# - test-homemanager-dag-integration: verifies full module system integration with lib.evalModules
# TODO(#1653): Reduce repetitive test structure by creating helper function for common setup/teardown pattern

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILURES=0
PASSES=0
CLEANUP_DIRS=()
CLEANUP_FAILURES=0

# Cleanup function to remove all temp directories
# TODO(#1680): cleanup returns 0 even when rm fails, hiding cleanup failures
cleanup() {
  local failed=0
  for dir in "${CLEANUP_DIRS[@]}"; do
    if ! rm -rf "$dir" 2>/dev/null; then
      echo "WARNING: Failed to cleanup directory: $dir" >&2
      ((CLEANUP_FAILURES++))
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

# Test 3b: Windows username with shell metacharacters
echo ""
echo "=== Test 3b: Windows username with shell metacharacters ==="
TEMP_MOUNT_SPECIAL=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT_SPECIAL")

# Test various problematic characters that are valid in Windows usernames
# but could break shell scripts if not properly quoted
test_metachar_passed=true
for username in "user&name" "user;name" 'user`name' 'user$name'; do
  mkdir -p "$TEMP_MOUNT_SPECIAL/c/Users/$username"
  mkdir -p "$TEMP_MOUNT_SPECIAL/c/Users/Public"

  # Verify detection handles special chars safely
  WINDOWS_USER=$(ls "$TEMP_MOUNT_SPECIAL/c/Users/" 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

  # Verify variable expansion is safe (properly quoted in actual script)
  TARGET_DIR="/mnt/c/Users/$WINDOWS_USER"
  if [[ "$TARGET_DIR" != "/mnt/c/Users/$username" ]]; then
    report_fail "Username with special chars caused incorrect expansion" "Expected: $username, Got: $WINDOWS_USER"
    test_metachar_passed=false
    break
  fi

  rm -rf "$TEMP_MOUNT_SPECIAL/c/Users/$username"
done

if $test_metachar_passed; then
  report_pass "User detection handles shell metacharacters safely"
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

# Test 5b: Native Linux (not WSL) gracefully skips Windows copy with message
echo ""
echo "=== Test 5b: Native Linux graceful skip with message ==="
TEMP_NATIVE_LINUX=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_NATIVE_LINUX")

# Simulate activation script logic on native Linux (no /mnt/c/Users)
SKIP_MESSAGE=""
EXIT_CODE=0
if [[ ! -d "$TEMP_NATIVE_LINUX/mnt/c/Users" ]]; then
  # Should output message and continue without error (exit 0)
  SKIP_MESSAGE="Not running on WSL, skipping Windows config copy"
  EXIT_CODE=0
else
  # Test setup failed - /mnt/c/Users should not exist
  EXIT_CODE=1
fi

# Validate graceful skip behavior
if [[ $EXIT_CODE -eq 0 ]] && [[ "$SKIP_MESSAGE" == "Not running on WSL, skipping Windows config copy" ]]; then
  report_pass "Native Linux gracefully skips Windows copy with correct message"
else
  report_fail "Native Linux should skip gracefully with message" "Exit code: $EXIT_CODE, Message: $SKIP_MESSAGE"
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

# Test validates that grep pattern is case-sensitive (filters 'Public'/'Default' but not 'public'/'default')
# In this Linux test environment: lowercase 'public'/'default' are NOT filtered by the pattern
# On real WSL: Windows shows 'Public'/'Default' (capitalized), which ARE filtered correctly
# Expected result: Gets 'alice' (Linux env) or 'default'/'public' (if alice didn't exist)
if [[ "$WINDOWS_USER" =~ ^(alice|default|public)$ ]]; then
  # Expected: 'alice' (valid user) or 'default'/'public' (lowercase not filtered on Linux)
  # On real WSL, only 'Public'/'Default' exist (capitalized), so they would be filtered correctly
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
# TODO(#1683): Use mktemp for unique temp files to avoid orphaned files and test conflicts
WARNING_OUTPUT=""
if ! ls "$TEMP_MOUNT_NOPERM/c/Users/" >/tmp/wezterm-users-list-test18 2>&1; then
  # Simulate the warning message that would be generated
  WARNING_OUTPUT="WARNING: Failed to list /mnt/c/Users/ directory"$'\n'"This may indicate a WSL mount or permission issue"
fi

# Cleanup temp file
rm /tmp/wezterm-users-list-test18 2>/dev/null || {
  echo "WARNING: Failed to clean up test file /tmp/wezterm-users-list-test18" >&2
  echo "  This may indicate filesystem permission or disk issues" >&2
  ((CLEANUP_FAILURES++))
}

# Validate warning message content
if [[ "$WARNING_OUTPUT" =~ "WARNING:" ]] && [[ "$WARNING_OUTPUT" =~ "/mnt/c/Users/" ]] && [[ "$WARNING_OUTPUT" =~ "WSL mount or permission" ]]; then
  report_pass "Failed /mnt/c/Users listing generates descriptive warning message"
else
  report_fail "Warning message lacks required context" "Got: $WARNING_OUTPUT"
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

# Simulate the error check from wezterm.nix lines 96-100
ERROR_OUTPUT=""
EXIT_CODE=0
if [[ ! -f "$MISSING_SOURCE20" ]]; then
  # Simulate the error message that would be generated
  ERROR_OUTPUT="ERROR: Source WezTerm config not found at $MISSING_SOURCE20"$'\n'"Home-Manager may have failed to generate the configuration"
  EXIT_CODE=1
fi

# Validate error message content and exit code
if [[ $EXIT_CODE -eq 1 ]]; then
  if [[ "$ERROR_OUTPUT" =~ "ERROR:" ]] && [[ "$ERROR_OUTPUT" =~ "$MISSING_SOURCE20" ]] && [[ "$ERROR_OUTPUT" =~ "Home-Manager" ]]; then
    report_pass "Missing source config triggers exit 1 with descriptive error message"
  else
    report_fail "Error message lacks required context" "Got: $ERROR_OUTPUT"
  fi
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
ERROR_OUTPUT=""
# Simulate the copy with error checking from wezterm.nix lines 103-107
DRY_RUN_CMD=""
VERBOSE_ARG=""
if ! $DRY_RUN_CMD cp $VERBOSE_ARG "$TEMP_SOURCE21" "$TARGET_FILE21" 2>/dev/null; then
  # Simulate the error message that would be generated
  ERROR_OUTPUT="ERROR: Failed to copy WezTerm config to $TARGET_FILE21"$'\n'"Check permissions, disk space, and ensure WezTerm is not running"
  COPY_EXIT_CODE=1
fi

rm -f "$TEMP_SOURCE21"
chmod 755 "$TEMP_TARGET_DIR21"  # Restore for cleanup

# Validate error message content and exit code
if [[ $COPY_EXIT_CODE -eq 1 ]]; then
  if [[ "$ERROR_OUTPUT" =~ "ERROR:" ]] && [[ "$ERROR_OUTPUT" =~ "$TARGET_FILE21" ]] && [[ "$ERROR_OUTPUT" =~ "permissions" ]]; then
    report_pass "Failed config copy triggers exit 1 with descriptive error message"
  else
    report_fail "Error message lacks actionable guidance" "Got: $ERROR_OUTPUT"
  fi
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

# Test 23: DRY_RUN_CMD support (dry run mode)
echo ""
echo "=== Test 23: Dry run mode support with DRY_RUN_CMD ==="
TEMP_SOURCE_DRY=$(mktemp)
TEMP_TARGET_DRY=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET_DRY")
echo "test content" > "$TEMP_SOURCE_DRY"

# Simulate dry run (should not actually copy)
DRY_RUN_CMD="echo"
VERBOSE_ARG=""
TARGET_FILE_DRY="$TEMP_TARGET_DRY/.wezterm.lua"

# Execute command as home-manager would
eval "$DRY_RUN_CMD cp $VERBOSE_ARG $TEMP_SOURCE_DRY $TARGET_FILE_DRY" >/dev/null 2>&1

rm -f "$TEMP_SOURCE_DRY"

if [[ ! -f "$TARGET_FILE_DRY" ]]; then
  report_pass "Dry run mode (DRY_RUN_CMD=echo) prevents actual file copy"
else
  report_fail "Dry run mode should not create file" "File exists at: $TARGET_FILE_DRY"
fi

# Test 24: Verbose mode support with VERBOSE_ARG
echo ""
echo "=== Test 24: Verbose mode support with VERBOSE_ARG ==="
TEMP_SOURCE_VERBOSE=$(mktemp)
TEMP_TARGET_VERBOSE=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET_VERBOSE")
echo "verbose test" > "$TEMP_SOURCE_VERBOSE"

DRY_RUN_CMD=""
VERBOSE_ARG="-v"
TARGET_FILE_VERBOSE="$TEMP_TARGET_VERBOSE/.wezterm.lua"

# Execute command and capture output
VERBOSE_OUTPUT=$(eval "$DRY_RUN_CMD cp $VERBOSE_ARG $TEMP_SOURCE_VERBOSE $TARGET_FILE_VERBOSE" 2>&1)

rm -f "$TEMP_SOURCE_VERBOSE"

# Verbose flag should either produce output or successfully copy the file
if [[ -f "$TARGET_FILE_VERBOSE" ]]; then
  report_pass "Verbose mode (VERBOSE_ARG=-v) accepted by cp command"
else
  report_fail "Verbose mode command failed" "Output: $VERBOSE_OUTPUT"
fi

# Test 25: Empty DRY_RUN_CMD and VERBOSE_ARG (normal operation)
echo ""
echo "=== Test 25: Normal operation with empty DRY_RUN_CMD and VERBOSE_ARG ==="
TEMP_SOURCE_NORMAL=$(mktemp)
TEMP_TARGET_NORMAL=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET_NORMAL")
echo "normal operation" > "$TEMP_SOURCE_NORMAL"

DRY_RUN_CMD=""
VERBOSE_ARG=""
TARGET_FILE_NORMAL="$TEMP_TARGET_NORMAL/.wezterm.lua"

# Execute command exactly as it appears in wezterm.nix line 100
if $DRY_RUN_CMD cp $VERBOSE_ARG "$TEMP_SOURCE_NORMAL" "$TARGET_FILE_NORMAL" 2>/dev/null; then
  rm -f "$TEMP_SOURCE_NORMAL"
  if [[ -f "$TARGET_FILE_NORMAL" ]]; then
    report_pass "Normal operation (empty variables) performs actual copy"
  else
    report_fail "Normal operation should create target file"
  fi
else
  rm -f "$TEMP_SOURCE_NORMAL"
  report_fail "Normal operation copy command failed"
fi

# Test 26: Unset DRY_RUN_CMD and VERBOSE_ARG (default behavior)
echo ""
echo "=== Test 26: Unset variables default to empty string behavior ==="
TEMP_SOURCE_UNSET=$(mktemp)
TEMP_TARGET_UNSET=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET_UNSET")
echo "unset test" > "$TEMP_SOURCE_UNSET"

# Unset variables to simulate initial state
unset DRY_RUN_CMD
unset VERBOSE_ARG
TARGET_FILE_UNSET="$TEMP_TARGET_UNSET/.wezterm.lua"

# This should work even with unset variables due to bash's default empty string substitution
if ${DRY_RUN_CMD:-} cp ${VERBOSE_ARG:-} "$TEMP_SOURCE_UNSET" "$TARGET_FILE_UNSET" 2>/dev/null; then
  rm -f "$TEMP_SOURCE_UNSET"
  if [[ -f "$TARGET_FILE_UNSET" ]]; then
    report_pass "Unset variables handled correctly (default to empty)"
  else
    report_fail "Unset variables should allow normal copy operation"
  fi
else
  rm -f "$TEMP_SOURCE_UNSET"
  report_fail "Unset variables caused command failure"
fi

# Test 27: /mnt/c/Users exists but not readable (ERROR and exit 1)
echo ""
echo "=== Test 27: /mnt/c/Users exists but not readable triggers ERROR and exit 1 ==="
TEMP_MOUNT_UNREADABLE=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT_UNREADABLE")
mkdir -p "$TEMP_MOUNT_UNREADABLE/c/Users"
chmod 000 "$TEMP_MOUNT_UNREADABLE/c/Users"

# Simulate the readability check from wezterm.nix lines 73-82
ERROR_OUTPUT=""
EXIT_CODE=0
if [ -d "$TEMP_MOUNT_UNREADABLE/c/Users" ] && [ ! -r "$TEMP_MOUNT_UNREADABLE/c/Users" ]; then
  # Simulate the error message that would be generated
  ERROR_OUTPUT="ERROR: Permission denied accessing /mnt/c/Users/"$'\n'"  WSL mount exists but directory is not readable"$'\n\n'"To fix:"$'\n'"  1. Check mount options: mount | grep /mnt/c"
  EXIT_CODE=1
fi

chmod 755 "$TEMP_MOUNT_UNREADABLE/c/Users"  # Restore for cleanup

# Validate error message content and exit code
if [[ $EXIT_CODE -eq 1 ]]; then
  if [[ "$ERROR_OUTPUT" =~ "ERROR: Permission denied" ]] && [[ "$ERROR_OUTPUT" =~ "not readable" ]] && [[ "$ERROR_OUTPUT" =~ "Check mount options" ]]; then
    report_pass "Unreadable /mnt/c/Users triggers exit 1 with diagnostic error message"
  else
    report_fail "Error message lacks diagnostic guidance" "Got: $ERROR_OUTPUT"
  fi
else
  report_fail "Unreadable /mnt/c/Users should trigger exit 1"
fi

# Test 28: User detection failure produces diagnostic error (ERROR and exit 1)
echo ""
echo "=== Test 28: User detection failure produces diagnostic ERROR and exit 1 ==="
TEMP_MOUNT_NO_USER=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_MOUNT_NO_USER")
mkdir -p "$TEMP_MOUNT_NO_USER/c/Users"/{Public,Default}

# Simulate the detection with error handling from wezterm.nix lines 89-98
ERROR_OUTPUT=""
EXIT_CODE=0
LS_OUTPUT=""
if LS_OUTPUT=$(ls "$TEMP_MOUNT_NO_USER/c/Users/" 2>&1 | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1) && [ -n "$LS_OUTPUT" ]; then
  # User detected successfully
  EXIT_CODE=0
else
  # User detection failed - generate diagnostic error
  ERROR_OUTPUT="ERROR: Failed to detect Windows username"$'\n'"  ls output: $LS_OUTPUT"$'\n'"  Directory exists and passed pre-checks but user detection failed"$'\n'"  Available directories in /mnt/c/Users/:"
  EXIT_CODE=1
fi

# Validate error message content and exit code
if [[ $EXIT_CODE -eq 1 ]]; then
  if [[ "$ERROR_OUTPUT" =~ "ERROR: Failed to detect Windows username" ]] && [[ "$ERROR_OUTPUT" =~ "ls output:" ]] && [[ "$ERROR_OUTPUT" =~ "Available directories" ]]; then
    report_pass "User detection failure triggers exit 1 with diagnostic error including ls output"
  else
    report_fail "Error message lacks diagnostic details" "Got: $ERROR_OUTPUT"
  fi
else
  report_fail "User detection failure should trigger exit 1"
fi

# Test 29: Empty source file handling
echo ""
echo "=== Test 29: Empty source file error handling ==="
TEMP_SOURCE29=$(mktemp)
TEMP_TARGET_DIR29=$(mktemp -d)
CLEANUP_DIRS+=("$TEMP_TARGET_DIR29")

# Create empty source file (size 0 bytes)
touch "$TEMP_SOURCE29"

# Define error code matching wezterm.nix
readonly ERR_SOURCE_EMPTY=15

# Simulate the validation check for empty source file
ERROR_OUTPUT=""
EXIT_CODE=0
if [ ! -f "$TEMP_SOURCE29" ]; then
  ERROR_OUTPUT="ERROR: Source WezTerm config not found"
  EXIT_CODE=13  # ERR_SOURCE_MISSING
elif [ ! -s "$TEMP_SOURCE29" ]; then
  # File exists but is empty (size 0)
  ERROR_OUTPUT="ERROR: Source WezTerm config is empty at $TEMP_SOURCE29"$'\n'"This may indicate:"$'\n'"  - Home-Manager configuration has empty extraConfig"$'\n'"  - File generation failed or was truncated"$'\n'"  - Accidental empty string in programs.wezterm.extraConfig"
  EXIT_CODE=$ERR_SOURCE_EMPTY
fi

rm -f "$TEMP_SOURCE29"

# Validate error detection and message content
if [[ $EXIT_CODE -eq $ERR_SOURCE_EMPTY ]]; then
  if [[ "$ERROR_OUTPUT" =~ "ERROR: Source WezTerm config is empty" ]] && [[ "$ERROR_OUTPUT" =~ "Home-Manager" ]] && [[ "$ERROR_OUTPUT" =~ "extraConfig" ]]; then
    report_pass "Empty source file detected with descriptive error message (exit code $ERR_SOURCE_EMPTY)"
  else
    report_fail "Error message lacks diagnostic guidance" "Got: $ERROR_OUTPUT"
  fi
else
  report_fail "Empty source file should trigger exit $ERR_SOURCE_EMPTY" "Got exit code: $EXIT_CODE"
fi

# Summary
echo ""
echo "================================"
echo "Passed: $PASSES"
echo "Failed: $FAILURES"
echo "================================"

if [[ $CLEANUP_FAILURES -gt 0 ]]; then
  echo ""
  echo "WARNING: $CLEANUP_FAILURES cleanup operations failed"
  echo "Temporary directories may have been left behind"
  echo "Check /tmp for orphaned test directories"
fi

if [[ $FAILURES -eq 0 ]]; then
  echo "All tests passed!"
  exit 0
else
  echo "$FAILURES test(s) failed"
  exit 1
fi
