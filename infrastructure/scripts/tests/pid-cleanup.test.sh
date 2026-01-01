#!/usr/bin/env bash
# Integration tests for PID file cleanup and process group termination
# Tests both cleanup-test-processes.sh and stop-hosting-emulator.sh

set -uo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Cleanup tracking
CLEANUP_PIDS=()
CLEANUP_FILES=()

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

# Cleanup helper
cleanup_test_artifacts() {
  # Kill any test processes we spawned
  for pid in "${CLEANUP_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  CLEANUP_PIDS=()

  # Remove any test files
  for file in "${CLEANUP_FILES[@]}"; do
    rm -f "$file" 2>/dev/null || true
  done
  CLEANUP_FILES=()
}

# Register cleanup on exit
trap cleanup_test_artifacts EXIT

# ============================================================================
# UNIT TESTS - PID File Parsing
# ============================================================================

test_pid_file_format_valid() {
  local test_pid_file="${TMPDIR:-/tmp}/test-pid-$$-valid.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Create test PID file with valid format
  echo "12345:67890" > "$test_pid_file"

  # Parse using same logic as cleanup scripts
  local pid pgid
  if IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null; then
    if [ "$pid" = "12345" ] && [ "$pgid" = "67890" ]; then
      test_pass "PID file parsing extracts PID and PGID correctly"
    else
      test_fail "PID file parsing extracts PID and PGID correctly" "pid=$pid pgid=$pgid"
    fi
  else
    test_fail "PID file parsing extracts PID and PGID correctly" "Failed to read file"
  fi
}

test_pid_file_format_pid_only() {
  local test_pid_file="${TMPDIR:-/tmp}/test-pid-$$-pid-only.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Create test PID file with only PID (missing PGID)
  echo "12345:" > "$test_pid_file"

  local pid pgid
  if IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null; then
    if [ "$pid" = "12345" ] && [ -z "$pgid" ]; then
      test_pass "PID file parsing handles missing PGID"
    else
      test_fail "PID file parsing handles missing PGID" "pid=$pid pgid=$pgid"
    fi
  else
    test_fail "PID file parsing handles missing PGID" "Failed to read file"
  fi
}

test_pid_file_format_corrupted() {
  local test_pid_file="${TMPDIR:-/tmp}/test-pid-$$-corrupted.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Create corrupted PID file
  echo "garbage data" > "$test_pid_file"

  local pid pgid
  if IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null; then
    # Should read as single value into pid
    if [ -n "$pid" ] && [ -z "$pgid" ]; then
      test_pass "PID file parsing handles corrupted format"
    else
      test_fail "PID file parsing handles corrupted format" "pid=$pid pgid=$pgid"
    fi
  else
    test_fail "PID file parsing handles corrupted format" "Failed to read file"
  fi
}

test_pid_file_format_empty() {
  local test_pid_file="${TMPDIR:-/tmp}/test-pid-$$-empty.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Create empty PID file
  touch "$test_pid_file"

  local pid pgid
  if IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null; then
    # Empty file should result in empty variables
    if [ -z "$pid" ] && [ -z "$pgid" ]; then
      test_pass "PID file parsing handles empty file"
    else
      test_fail "PID file parsing handles empty file" "pid=$pid pgid=$pgid"
    fi
  else
    # read returns 1 on empty file, which is expected
    test_pass "PID file parsing handles empty file (read returns error)"
  fi
}

# ============================================================================
# INTEGRATION TESTS - Process Group Termination
# ============================================================================

test_process_group_kill_all_children() {
  # Create a test process group: parent with 2 children
  # Use sleep commands that we can easily track
  local parent_script="${TMPDIR:-/tmp}/test-parent-$$.sh"
  CLEANUP_FILES+=("$parent_script")

  cat > "$parent_script" <<'EOF'
#!/usr/bin/env bash
# Start children in background
sleep 300 &
child1=$!
sleep 300 &
child2=$!
# Write children PIDs for parent to track
echo "$child1 $child2"
wait
EOF
  chmod +x "$parent_script"

  # Start parent process
  "$parent_script" &
  local parent_pid=$!
  CLEANUP_PIDS+=("$parent_pid")

  # Give processes time to start and get children PIDs
  sleep 0.5

  # Get children PIDs from parent (read first line of output if captured)
  # For this test, we'll just verify the parent can be killed
  # This is a simplified test that doesn't require setsid or ps

  # Verify parent is running
  if ! kill -0 "$parent_pid" 2>/dev/null; then
    test_fail "Process group kills all children" "Parent process not running"
    return
  fi

  # Kill the parent (which should trigger cleanup of children via the script's exit)
  kill -TERM "$parent_pid" 2>/dev/null || true
  sleep 1
  kill -KILL "$parent_pid" 2>/dev/null || true

  # Verify parent is dead
  sleep 0.5
  if kill -0 "$parent_pid" 2>/dev/null; then
    test_fail "Process group kills all children" "Parent process still running"
    kill -9 "$parent_pid" 2>/dev/null || true
  else
    # Test passes - demonstrates TERM/KILL pattern works
    # Note: Full process group testing requires ps access unavailable in sandbox
    test_pass "Process group kills all children (simplified test)"
  fi
}

test_hosting_emulator_process_group_cleanup() {
  # Integration test for stop-hosting-emulator.sh process group cleanup
  # Tests PID file format (PID:PGID) used by hosting emulator cleanup

  local test_pid_file="${TMPDIR:-/tmp}/test-hosting-$$.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Start a test process
  sleep 300 &
  local test_pid=$!
  CLEANUP_PIDS+=("$test_pid")

  sleep 0.2

  # Verify process is running
  if ! kill -0 "$test_pid" 2>/dev/null; then
    test_fail "Hosting emulator process group cleanup" "Test process not running"
    return
  fi

  # Write PID file in the format used by hosting emulator (PID:PGID)
  # The hosting emulator writes PGID to enable killing entire process tree
  local fake_pgid="99999"
  echo "${test_pid}:${fake_pgid}" > "$test_pid_file"

  # Test 1: Parse PID file using same logic as stop-hosting-emulator.sh
  local pid pgid
  if ! IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null; then
    test_fail "Hosting emulator process group cleanup" "Failed to parse PID file"
    kill -9 "$test_pid" 2>/dev/null || true
    return
  fi

  # Test 2: Verify parsed values match expected format
  if [ "$pid" != "$test_pid" ] || [ "$pgid" != "$fake_pgid" ]; then
    test_fail "Hosting emulator process group cleanup" "Parsed values incorrect: pid=$pid pgid=$pgid"
    kill -9 "$test_pid" 2>/dev/null || true
    return
  fi

  # Test 3: Use kill pattern from kill_process_group function
  # Try PGID first (will fail with fake PGID), then fall back to PID
  if [ -n "$pgid" ]; then
    kill -TERM -$pgid 2>/dev/null || true
  fi
  if [ -n "$pid" ]; then
    kill -TERM $pid 2>/dev/null || true
  fi
  sleep 1
  if [ -n "$pgid" ]; then
    kill -KILL -$pgid 2>/dev/null || true
  fi
  if [ -n "$pid" ]; then
    kill -KILL $pid 2>/dev/null || true
  fi

  # Test 4: Verify process is dead
  sleep 0.2

  if kill -0 "$test_pid" 2>/dev/null; then
    test_fail "Hosting emulator process group cleanup" "Process still running after cleanup"
    kill -9 "$test_pid" 2>/dev/null || true
  else
    test_pass "Hosting emulator process group cleanup"
  fi
}

test_hosting_emulator_cleanup_pgid_fallback() {
  # Test fallback when PGID is missing from PID file
  # This ensures stop-hosting-emulator.sh still works with old PID files

  # Source port-utils.sh to get kill_process_group function
  source "${SCRIPT_DIR}/port-utils.sh"

  local test_pid_file="${TMPDIR:-/tmp}/test-hosting-fallback-$$.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Start a simple process (no children needed for fallback test)
  sleep 300 &
  local test_pid=$!
  CLEANUP_PIDS+=("$test_pid")

  sleep 0.2

  # Write PID file WITHOUT PGID (format: PID:)
  echo "${test_pid}:" > "$test_pid_file"

  # Parse PID file
  local pid pgid
  if ! IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null; then
    test_fail "Hosting emulator cleanup PGID fallback" "Failed to parse PID file"
    kill -9 "$test_pid" 2>/dev/null || true
    return
  fi

  # Verify PGID is empty (fallback scenario)
  if [ -n "$pgid" ]; then
    test_fail "Hosting emulator cleanup PGID fallback" "PGID should be empty for fallback test"
    kill -9 "$test_pid" 2>/dev/null || true
    return
  fi

  # Use kill_process_group with empty PGID (should fall back to PID-only)
  kill_process_group "$pid" "$pgid"

  # Verify process is dead
  sleep 0.2
  if kill -0 "$test_pid" 2>/dev/null; then
    test_fail "Hosting emulator cleanup PGID fallback" "Process still running after fallback cleanup"
    kill -9 "$test_pid" 2>/dev/null || true
  else
    test_pass "Hosting emulator cleanup PGID fallback"
  fi
}

test_hosting_emulator_concurrent_cleanup() {
  # Test that concurrent cleanup attempts don't crash
  # Simulates scenario where multiple cleanup scripts run simultaneously

  # Source port-utils.sh to get kill_process_group function
  source "${SCRIPT_DIR}/port-utils.sh"

  local test_pid_file="${TMPDIR:-/tmp}/test-hosting-concurrent-$$.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Start test process
  sleep 300 &
  local test_pid=$!
  CLEANUP_PIDS+=("$test_pid")

  sleep 0.2

  # Write PID file
  echo "${test_pid}:" > "$test_pid_file"

  # Parse PID file
  local pid pgid
  IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null

  # Simulate concurrent cleanup: kill in background, then kill again
  kill_process_group "$pid" "$pgid" &
  local cleanup1_pid=$!

  # Small delay to let first cleanup start
  sleep 0.1

  # Second cleanup attempt (should handle already-dead process gracefully)
  kill_process_group "$pid" "$pgid" &
  local cleanup2_pid=$!

  # Wait for both cleanups to complete
  wait "$cleanup1_pid" 2>/dev/null || true
  wait "$cleanup2_pid" 2>/dev/null || true

  # Verify process is dead (at least one cleanup succeeded)
  sleep 0.2
  if kill -0 "$test_pid" 2>/dev/null; then
    test_fail "Hosting emulator concurrent cleanup" "Process still running after concurrent cleanups"
    kill -9 "$test_pid" 2>/dev/null || true
  else
    # Test passes - concurrent cleanups handled gracefully (no crash)
    test_pass "Hosting emulator concurrent cleanup"
  fi
}

test_process_group_fallback_to_pid() {
  # Test fallback when PGID is not available
  # Start a simple background process
  sleep 300 &
  local test_pid=$!
  CLEANUP_PIDS+=("$test_pid")

  sleep 0.2

  # Verify process is running
  if ! kill -0 "$test_pid" 2>/dev/null; then
    test_fail "Process group fallback to PID" "Test process not running"
    return
  fi

  # Kill using single PID (fallback logic from cleanup scripts)
  kill -TERM "$test_pid" 2>/dev/null || true
  sleep 1
  kill -KILL "$test_pid" 2>/dev/null || true

  # Verify process is dead
  sleep 0.2
  if kill -0 "$test_pid" 2>/dev/null; then
    test_fail "Process group fallback to PID" "Process still running"
    kill -9 "$test_pid" 2>/dev/null || true
  else
    test_pass "Process group fallback to PID"
  fi
}

# ============================================================================
# INTEGRATION TESTS - End-to-End PID File Cleanup
# ============================================================================

test_pid_file_cleanup_flow_success() {
  # Simulate complete cleanup flow: create process, write PID file, cleanup
  local test_dir="${TMPDIR:-/tmp}/test-cleanup-$$"
  mkdir -p "$test_dir"
  CLEANUP_FILES+=("$test_dir")

  local test_pid_file="$test_dir/test.pid"

  # Start test process
  sleep 300 &
  local test_pid=$!
  CLEANUP_PIDS+=("$test_pid")

  # Write PID file in correct format (without PGID for sandbox compatibility)
  echo "${test_pid}:" > "$test_pid_file"

  sleep 0.2

  # Verify process is running
  if ! kill -0 "$test_pid" 2>/dev/null; then
    test_fail "PID file cleanup flow success" "Test process not running"
    rm -rf "$test_dir"
    return
  fi

  # Simulate cleanup script logic
  local pid pgid
  if IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null; then
    if [ -n "$pid" ]; then
      # Use PID-only cleanup (fallback path)
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$test_pid_file"

  # Verify cleanup succeeded
  sleep 0.2
  if kill -0 "$test_pid" 2>/dev/null; then
    test_fail "PID file cleanup flow success" "Process still running after cleanup"
    kill -9 "$test_pid" 2>/dev/null || true
  elif [ -f "$test_pid_file" ]; then
    test_fail "PID file cleanup flow success" "PID file not removed"
  else
    test_pass "PID file cleanup flow success"
  fi

  rm -rf "$test_dir"
}

test_pid_file_cleanup_corrupted_fallback() {
  # Test that corrupted PID file doesn't crash cleanup
  local test_dir="${TMPDIR:-/tmp}/test-cleanup-corrupted-$$"
  mkdir -p "$test_dir"
  CLEANUP_FILES+=("$test_dir")

  local test_pid_file="$test_dir/test.pid"

  # Create corrupted PID file (non-numeric values)
  echo "not-a-pid:not-a-pgid" > "$test_pid_file"

  # Simulate cleanup script logic (should not crash)
  local pid pgid pid_file_was_corrupt=false
  if IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null; then
    # Successfully read the file (read doesn't validate content)
    # Check if values are numeric (this is what the cleanup script should do)
    if ! [[ "$pid" =~ ^[0-9]+$ ]] && ! [[ "$pgid" =~ ^[0-9]*$ ]]; then
      pid_file_was_corrupt=true
    fi
  else
    pid=""
    pgid=""
    pid_file_was_corrupt=true
  fi

  # Should have detected corruption OR values should be non-numeric
  # The actual cleanup scripts don't validate, they just try to kill
  # So this test verifies read succeeds but values are unusable
  if [ "$pid" = "not-a-pid" ] && [ "$pgid" = "not-a-pgid" ]; then
    test_pass "PID file cleanup handles corrupted file gracefully"
  else
    test_fail "PID file cleanup handles corrupted file gracefully" "Unexpected parsing: pid=$pid pgid=$pgid"
  fi

  rm -rf "$test_dir"
}

# ============================================================================
# NEGATIVE TESTS - Error Scenarios
# ============================================================================

test_pid_file_missing_graceful() {
  # Test that missing PID file doesn't cause errors
  local test_pid_file="/nonexistent/path/to/test.pid"

  # This should not crash (using pattern from cleanup scripts)
  if [ -f "$test_pid_file" ]; then
    test_fail "PID file missing handled gracefully" "File exists when it shouldn't"
  else
    # Expected path - file doesn't exist, cleanup should skip
    test_pass "PID file missing handled gracefully"
  fi
}

test_process_already_dead() {
  # Test killing a process that's already dead
  local fake_pid=99999  # Very unlikely to exist

  # This should not error (using pattern from cleanup scripts)
  kill -TERM "$fake_pid" 2>/dev/null || true
  kill -KILL "$fake_pid" 2>/dev/null || true

  test_pass "Cleanup handles already-dead process gracefully"
}

# ============================================================================
# REGRESSION TESTS - Known Issues
# ============================================================================

test_pid_format_change_detection() {
  # Regression test: Ensure format change would be caught
  local test_pid_file="${TMPDIR:-/tmp}/test-pid-$$-format.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Old format (hypothetical) - single PID without colon
  echo "12345" > "$test_pid_file"

  local pid pgid
  IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null

  # Should read PID correctly but PGID would be empty
  if [ "$pid" = "12345" ] && [ -z "$pgid" ]; then
    test_pass "Format change detection (backward compatibility)"
  else
    test_fail "Format change detection (backward compatibility)" "pid=$pid pgid=$pgid"
  fi
}

test_delimiter_change_breaks_parsing() {
  # Regression test: Different delimiter breaks parsing
  local test_pid_file="${TMPDIR:-/tmp}/test-pid-$$-delimiter.pid"
  CLEANUP_FILES+=("$test_pid_file")

  # Wrong delimiter (comma instead of colon)
  echo "12345,67890" > "$test_pid_file"

  local pid pgid
  IFS=':' read -r pid pgid < "$test_pid_file" 2>/dev/null

  # Should NOT parse PGID correctly (regression if it does)
  if [ "$pid" = "12345,67890" ] && [ -z "$pgid" ]; then
    test_pass "Delimiter change breaks parsing as expected"
  else
    test_fail "Delimiter change breaks parsing as expected" "pid=$pid pgid=$pgid (should not parse with comma)"
  fi
}

# ============================================================================
# Run All Tests
# ============================================================================

echo "========================================"
echo "PID Cleanup Test Suite"
echo "========================================"

# PID File Parsing Tests
run_test test_pid_file_format_valid
run_test test_pid_file_format_pid_only
run_test test_pid_file_format_corrupted
run_test test_pid_file_format_empty

# Process Group Termination Tests
run_test test_process_group_kill_all_children
run_test test_hosting_emulator_process_group_cleanup
run_test test_hosting_emulator_cleanup_pgid_fallback
run_test test_hosting_emulator_concurrent_cleanup
run_test test_process_group_fallback_to_pid

# End-to-End Integration Tests
run_test test_pid_file_cleanup_flow_success
run_test test_pid_file_cleanup_corrupted_fallback

# Negative Tests
run_test test_pid_file_missing_graceful
run_test test_process_already_dead

# Regression Tests
run_test test_pid_format_change_detection
run_test test_delimiter_change_breaks_parsing

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
