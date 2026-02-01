#!/usr/bin/env bash
# Tests for worktree-registry.sh

set -uo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY_SCRIPT="${SCRIPT_DIR}/worktree-registry.sh"

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

  # Setup for each test
  setup

  # Run the test
  $test_name

  # Teardown for each test
  teardown
}

# Setup function - creates isolated test environment
setup() {
  # Create temporary test directory
  TEST_DIR=$(mktemp -d)
  export HOME="$TEST_DIR"

  # Override registry paths to use test directory
  export REGISTRY_DIR="${TEST_DIR}/.firebase-emulators"
  export REGISTRY_FILE="${REGISTRY_DIR}/worktree-registrations.json"
  export REGISTRY_LOCK="${REGISTRY_DIR}/worktree-registry.lock"

  # Create test worktree
  TEST_WORKTREE="${TEST_DIR}/test-worktree"
  mkdir -p "$TEST_WORKTREE"
  git init "$TEST_WORKTREE" >/dev/null 2>&1
}

# Teardown function - cleans up test environment
teardown() {
  # Clean up test directory
  rm -rf "$TEST_DIR" 2>/dev/null || true
}

# Helper function to create a test worktree
create_test_worktree() {
  local name="$1"
  local path="${TEST_DIR}/${name}"
  mkdir -p "$path"
  git init "$path" >/dev/null 2>&1
  echo "$path"
}

# Helper function to get registration count
get_registration_count() {
  jq '.registrations | length' "$REGISTRY_FILE" 2>/dev/null || echo 0
}

# ============================================================================
# REGISTRATION TESTS
# ============================================================================

test_register_creates_registry_file() {
  local output
  output=$("$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "test-project" "singleton" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [ -f "$REGISTRY_FILE" ]; then
    test_pass "register creates registry file"
  else
    test_fail "register creates registry file" "Exit code: $exit_code, file exists: $([ -f "$REGISTRY_FILE" ] && echo yes || echo no)"
  fi
}

test_register_adds_entry() {
  "$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "test-project" "singleton" >/dev/null 2>&1

  local count=$(get_registration_count)
  local worktree=$(jq -r '.registrations[0].worktreeRoot' "$REGISTRY_FILE" 2>/dev/null)

  if [ "$count" -eq 1 ] && [ "$worktree" = "$TEST_WORKTREE" ]; then
    test_pass "register adds entry to registry"
  else
    test_fail "register adds entry to registry" "Count: $count, Worktree: $worktree"
  fi
}

test_register_validates_worktree_exists() {
  local output
  output=$("$REGISTRY_SCRIPT" register "/nonexistent/path" "test-project" "singleton" 2>&1)
  local exit_code=$?

  if [ $exit_code -ne 0 ] && [[ "$output" =~ "ERROR: Worktree root does not exist" ]]; then
    test_pass "register validates worktree root exists"
  else
    test_fail "register validates worktree root exists" "Exit code: $exit_code, Output: $output"
  fi
}

test_register_validates_git_repository() {
  local non_git_dir="${TEST_DIR}/not-a-repo"
  mkdir -p "$non_git_dir"

  local output
  output=$("$REGISTRY_SCRIPT" register "$non_git_dir" "test-project" "singleton" 2>&1)
  local exit_code=$?

  if [ $exit_code -ne 0 ] && [[ "$output" =~ "ERROR: Worktree root is not a git repository" ]]; then
    test_pass "register validates worktree is git repository"
  else
    test_fail "register validates worktree is git repository" "Exit code: $exit_code, Output: $output"
  fi
}

test_register_validates_mode() {
  local output
  output=$("$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "test-project" "invalid-mode" 2>&1)
  local exit_code=$?

  if [ $exit_code -ne 0 ] && [[ "$output" =~ "ERROR: Mode must be either 'singleton' or 'pool'" ]]; then
    test_pass "register validates mode is singleton or pool"
  else
    test_fail "register validates mode is singleton or pool" "Exit code: $exit_code, Output: $output"
  fi
}

test_register_updates_existing() {
  "$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "project-1" "singleton" >/dev/null 2>&1
  "$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "project-2" "pool" >/dev/null 2>&1

  local count=$(get_registration_count)
  local project=$(jq -r '.registrations[0].projectId' "$REGISTRY_FILE" 2>/dev/null)
  local mode=$(jq -r '.registrations[0].mode' "$REGISTRY_FILE" 2>/dev/null)

  if [ "$count" -eq 1 ] && [ "$project" = "project-2" ] && [ "$mode" = "pool" ]; then
    test_pass "register updates existing registration"
  else
    test_fail "register updates existing registration" "Count: $count, Project: $project, Mode: $mode"
  fi
}

test_register_handles_pool_id() {
  "$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "test-project" "pool" "pool-1" >/dev/null 2>&1

  local pool_id=$(jq -r '.registrations[0].poolInstanceId' "$REGISTRY_FILE" 2>/dev/null)

  if [ "$pool_id" = "pool-1" ]; then
    test_pass "register handles pool instance ID"
  else
    test_fail "register handles pool instance ID" "Pool ID: $pool_id"
  fi
}

test_register_handles_null_pool_id() {
  "$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "test-project" "singleton" >/dev/null 2>&1

  local pool_id=$(jq -r '.registrations[0].poolInstanceId' "$REGISTRY_FILE" 2>/dev/null)

  if [ "$pool_id" = "null" ]; then
    test_pass "register handles null pool instance ID"
  else
    test_fail "register handles null pool instance ID" "Pool ID: $pool_id"
  fi
}

# ============================================================================
# UNREGISTRATION TESTS
# ============================================================================

test_unregister_removes_entry() {
  "$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "test-project" "singleton" >/dev/null 2>&1

  local output
  output=$("$REGISTRY_SCRIPT" unregister "$TEST_WORKTREE" 2>&1)
  local exit_code=$?

  local count=$(get_registration_count)

  if [ $exit_code -eq 0 ] && [ "$count" -eq 0 ]; then
    test_pass "unregister removes registration"
  else
    test_fail "unregister removes registration" "Exit code: $exit_code, Count: $count"
  fi
}

test_unregister_handles_nonexistent() {
  local output
  output=$("$REGISTRY_SCRIPT" unregister "/nonexistent/path" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [[ "$output" =~ "No registration found" ]]; then
    test_pass "unregister handles non-existent registration"
  else
    test_fail "unregister handles non-existent registration" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# COUNT TESTS
# ============================================================================

test_count_empty_registry() {
  local output
  output=$("$REGISTRY_SCRIPT" count 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [ "$output" = "0" ]; then
    test_pass "count returns 0 for empty registry"
  else
    test_fail "count returns 0 for empty registry" "Exit code: $exit_code, Output: $output"
  fi
}

test_count_multiple_registrations() {
  local wt1=$(create_test_worktree "wt1")
  local wt2=$(create_test_worktree "wt2")
  local wt3=$(create_test_worktree "wt3")

  "$REGISTRY_SCRIPT" register "$wt1" "project-1" "singleton" >/dev/null 2>&1
  "$REGISTRY_SCRIPT" register "$wt2" "project-2" "pool" >/dev/null 2>&1
  "$REGISTRY_SCRIPT" register "$wt3" "project-3" "singleton" >/dev/null 2>&1

  local output
  output=$("$REGISTRY_SCRIPT" count 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [ "$output" = "3" ]; then
    test_pass "count returns correct number of registrations"
  else
    test_fail "count returns correct number of registrations" "Exit code: $exit_code, Output: $output"
  fi
}

# ============================================================================
# CLEANUP TESTS
# ============================================================================

test_cleanup_removes_stale() {
  local wt_live=$(create_test_worktree "live")
  local wt_stale="${TEST_DIR}/stale"

  # Create registration for live worktree
  "$REGISTRY_SCRIPT" register "$wt_live" "project-live" "singleton" >/dev/null 2>&1

  # Manually add a stale registration
  local temp_file=$(mktemp)
  jq ".registrations += [{
    \"worktreeRoot\": \"$wt_stale\",
    \"projectId\": \"project-stale\",
    \"registeredAt\": 1234567890,
    \"hostingPort\": 5042,
    \"mode\": \"singleton\",
    \"poolInstanceId\": null
  }]" "$REGISTRY_FILE" > "$temp_file"
  mv "$temp_file" "$REGISTRY_FILE"

  # Run count to trigger cleanup
  local output
  output=$("$REGISTRY_SCRIPT" count 2>&1)
  local exit_code=$?

  local count=$(get_registration_count)
  local remaining=$(jq -r '.registrations[0].worktreeRoot' "$REGISTRY_FILE" 2>/dev/null)

  if [ $exit_code -eq 0 ] && [ "$output" = "1" ] && [ "$count" -eq 1 ] && [ "$remaining" = "$wt_live" ]; then
    test_pass "cleanup removes stale registrations"
  else
    test_fail "cleanup removes stale registrations" "Exit: $exit_code, Output: $output, Count: $count, Remaining: $remaining"
  fi
}

test_cleanup_preserves_valid() {
  local wt1=$(create_test_worktree "wt1")
  local wt2=$(create_test_worktree "wt2")
  local wt3=$(create_test_worktree "wt3")

  "$REGISTRY_SCRIPT" register "$wt1" "project-1" "singleton" >/dev/null 2>&1
  "$REGISTRY_SCRIPT" register "$wt2" "project-2" "pool" >/dev/null 2>&1
  "$REGISTRY_SCRIPT" register "$wt3" "project-3" "singleton" >/dev/null 2>&1

  local output
  output=$("$REGISTRY_SCRIPT" count 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [ "$output" = "3" ]; then
    test_pass "cleanup preserves all valid registrations"
  else
    test_fail "cleanup preserves all valid registrations" "Exit code: $exit_code, Output: $output"
  fi
}

test_cleanup_handles_empty_registry() {
  # Initialize empty registry
  mkdir -p "$REGISTRY_DIR"
  echo '{"registrations": []}' > "$REGISTRY_FILE"

  local output
  output=$("$REGISTRY_SCRIPT" count 2>&1)
  local exit_code=$?

  # Verify registry still valid
  local valid=0
  jq empty "$REGISTRY_FILE" 2>/dev/null && valid=1

  if [ $exit_code -eq 0 ] && [ "$output" = "0" ] && [ $valid -eq 1 ]; then
    test_pass "cleanup handles empty registry"
  else
    test_fail "cleanup handles empty registry" "Exit: $exit_code, Output: $output, Valid JSON: $valid"
  fi
}

test_cleanup_handles_all_stale() {
  # Manually create registry with only stale entries
  mkdir -p "$REGISTRY_DIR"
  cat > "$REGISTRY_FILE" <<EOF
{
  "registrations": [
    {
      "worktreeRoot": "/tmp/nonexistent1",
      "projectId": "project-1",
      "registeredAt": 1234567890,
      "hostingPort": 5042,
      "mode": "singleton",
      "poolInstanceId": null
    },
    {
      "worktreeRoot": "/tmp/nonexistent2",
      "projectId": "project-2",
      "registeredAt": 1234567890,
      "hostingPort": 5042,
      "mode": "pool",
      "poolInstanceId": "pool-1"
    }
  ]
}
EOF

  # Run cleanup
  local output
  output=$("$REGISTRY_SCRIPT" count 2>&1)
  local exit_code=$?

  local count=$(get_registration_count)
  local valid=0
  jq empty "$REGISTRY_FILE" 2>/dev/null && valid=1

  if [ $exit_code -eq 0 ] && [ "$output" = "0" ] && [ $count -eq 0 ] && [ $valid -eq 1 ]; then
    test_pass "cleanup handles all stale registrations"
  else
    test_fail "cleanup handles all stale registrations" "Exit: $exit_code, Output: $output, Count: $count, Valid: $valid"
  fi
}

test_cleanup_generates_valid_json() {
  local wt1=$(create_test_worktree "wt1")

  "$REGISTRY_SCRIPT" register "$wt1" "project-1" "singleton" >/dev/null 2>&1

  # Run cleanup via count
  local output
  output=$("$REGISTRY_SCRIPT" count 2>&1)
  local exit_code=$?

  # Verify JSON is still valid
  local valid=0
  jq empty "$REGISTRY_FILE" 2>/dev/null && valid=1

  if [ $exit_code -eq 0 ] && [ $valid -eq 1 ]; then
    test_pass "cleanup generates valid JSON"
  else
    test_fail "cleanup generates valid JSON" "Exit code: $exit_code, Valid JSON: $valid"
  fi
}

# ============================================================================
# LIST TESTS
# ============================================================================

test_list_empty_registry() {
  local output
  output=$("$REGISTRY_SCRIPT" list 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [[ "$output" =~ "No active worktree registrations" ]]; then
    test_pass "list shows no registrations for empty registry"
  else
    test_fail "list shows no registrations for empty registry" "Exit code: $exit_code, Output: $output"
  fi
}

test_list_displays_details() {
  "$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "test-project" "singleton" >/dev/null 2>&1

  local output
  output=$("$REGISTRY_SCRIPT" list 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ] && [[ "$output" =~ "Active Worktree Registrations" ]] && \
     [[ "$output" =~ "$TEST_WORKTREE" ]] && [[ "$output" =~ "test-project" ]] && \
     [[ "$output" =~ "singleton" ]]; then
    test_pass "list displays registration details"
  else
    test_fail "list displays registration details" "Exit code: $exit_code"
  fi
}

# ============================================================================
# JSON STRUCTURE TESTS
# ============================================================================

test_registry_structure() {
  "$REGISTRY_SCRIPT" register "$TEST_WORKTREE" "test-project" "singleton" >/dev/null 2>&1

  # Verify JSON structure
  local has_registrations=0
  local has_worktree=0
  local has_project=0
  local has_registered_at=0
  local has_mode=0

  jq -e '.registrations' "$REGISTRY_FILE" >/dev/null 2>&1 && has_registrations=1
  jq -e '.registrations[0].worktreeRoot' "$REGISTRY_FILE" >/dev/null 2>&1 && has_worktree=1
  jq -e '.registrations[0].projectId' "$REGISTRY_FILE" >/dev/null 2>&1 && has_project=1
  jq -e '.registrations[0].registeredAt' "$REGISTRY_FILE" >/dev/null 2>&1 && has_registered_at=1
  jq -e '.registrations[0].mode' "$REGISTRY_FILE" >/dev/null 2>&1 && has_mode=1

  if [ $has_registrations -eq 1 ] && [ $has_worktree -eq 1 ] && [ $has_project -eq 1 ] && \
     [ $has_registered_at -eq 1 ] && [ $has_mode -eq 1 ]; then
    test_pass "registry file created with correct structure"
  else
    test_fail "registry file created with correct structure" \
      "registrations: $has_registrations, worktree: $has_worktree, project: $has_project, " \
      "registeredAt: $has_registered_at, mode: $has_mode"
  fi
}

# ============================================================================
# CONCURRENT OPERATION TESTS
# ============================================================================

test_concurrent_registrations() {
  # Create multiple test worktrees
  local wt1=$(create_test_worktree "concurrent1")
  local wt2=$(create_test_worktree "concurrent2")
  local wt3=$(create_test_worktree "concurrent3")

  # Register concurrently
  "$REGISTRY_SCRIPT" register "$wt1" "project-1" "singleton" >/dev/null 2>&1 &
  "$REGISTRY_SCRIPT" register "$wt2" "project-2" "pool" >/dev/null 2>&1 &
  "$REGISTRY_SCRIPT" register "$wt3" "project-3" "singleton" >/dev/null 2>&1 &

  wait

  # Verify all registered
  local count=$(get_registration_count)

  # Verify JSON is valid
  local valid=0
  jq empty "$REGISTRY_FILE" 2>/dev/null && valid=1

  if [ "$count" -eq 3 ] && [ $valid -eq 1 ]; then
    test_pass "concurrent registrations do not corrupt registry"
  else
    test_fail "concurrent registrations do not corrupt registry" "Count: $count, Valid JSON: $valid"
  fi
}

# ============================================================================
# RUN ALL TESTS
# ============================================================================

main() {
  echo "========================================"
  echo "Worktree Registry Test Suite"
  echo "========================================"

  # Registration tests
  run_test test_register_creates_registry_file
  run_test test_register_adds_entry
  run_test test_register_validates_worktree_exists
  run_test test_register_validates_git_repository
  run_test test_register_validates_mode
  run_test test_register_updates_existing
  run_test test_register_handles_pool_id
  run_test test_register_handles_null_pool_id

  # Unregistration tests
  run_test test_unregister_removes_entry
  run_test test_unregister_handles_nonexistent

  # Count tests
  run_test test_count_empty_registry
  run_test test_count_multiple_registrations

  # Cleanup tests
  run_test test_cleanup_removes_stale
  run_test test_cleanup_preserves_valid
  run_test test_cleanup_handles_empty_registry
  run_test test_cleanup_handles_all_stale
  run_test test_cleanup_generates_valid_json

  # List tests
  run_test test_list_empty_registry
  run_test test_list_displays_details

  # Structure tests
  run_test test_registry_structure

  # Concurrent operation tests
  run_test test_concurrent_registrations

  # Print summary
  echo ""
  echo "========================================"
  echo "Test Summary"
  echo "========================================"
  echo "Tests run:    $TESTS_RUN"
  echo "Tests passed: $TESTS_PASSED"
  echo "Tests failed: $TESTS_FAILED"
  echo ""

  if [ $TESTS_FAILED -eq 0 ]; then
    echo "✓ All tests passed!"
    exit 0
  else
    echo "✗ Some tests failed"
    exit 1
  fi
}

main "$@"
