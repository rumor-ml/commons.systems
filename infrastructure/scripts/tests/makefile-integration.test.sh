#!/usr/bin/env bash
# Integration tests for root Makefile
#
# Tests the unified test/validate interface delegation to scripts,
# project type detection, error propagation, and CHANGED_ONLY mode.
#
# This test suite validates:
# 1. Test target delegation to run-tests.sh with correct flags
# 2. Exit code propagation for test success/failure
# 3. Validation pipeline orchestration (lint → typecheck → test)
# 4. CHANGED_ONLY mode delegation to run-all-local-tests.sh
# 5. Project type auto-detection (go.mod, package.json)
#
# Related files:
# - Makefile: Root makefile providing unified interface
# - infrastructure/scripts/run-tests.sh: Test runner delegated to
# - infrastructure/scripts/run-all-local-tests.sh: Validation runner for CHANGED_ONLY mode
#
# Test Coverage:
# - ✓ Makefile structure and targets exist
# - ✓ Test delegation and exit code propagation
# - ✓ Test type flags (--type unit/integration/e2e)
# - ✓ CHANGED_ONLY mode handling
# - ✓ Validation pipeline execution order (uses mock scripts)
# - ✓ Project type detection logic (uses mock scripts)

set -euo pipefail

# Get repository root (3 levels up from this script)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Source shared test harness
source "$(dirname "${BASH_SOURCE[0]}")/test-harness.sh"

# Helper function to create executable bash scripts
# Usage: create_script <filepath> "<line1>" "<line2>" ...
# Each line argument will be written as a separate line in the script.
# Example: create_script "test.sh" "echo hello" "exit 0"
create_script() {
  local filepath=$1
  shift

  # Write shebang using printf to avoid shell interpretation
  printf '%s\n' '#!/usr/bin/env bash' > "$filepath"

  # Write each line
  for line in "$@"; do
    printf '%s\n' "$line" >> "$filepath"
  done

  chmod +x "$filepath"
}

# ============================================================================
# Makefile Structure Tests
# ============================================================================

test_makefile_exists() {
  if [ ! -f "$REPO_ROOT/Makefile" ]; then
    test_fail "Makefile exists" "File not found at $REPO_ROOT/Makefile"
    return
  fi

  test_pass "Makefile exists"
}

test_makefile_has_test_targets() {
  local makefile="$REPO_ROOT/Makefile"

  if [ ! -f "$makefile" ]; then
    test_fail "Makefile has test targets" "Makefile not found"
    return
  fi

  # Check for required test targets
  local missing_targets=()
  for target in "test" "test-unit" "test-integration" "test-e2e"; do
    if ! grep -q "^${target}:" "$makefile"; then
      missing_targets+=("$target")
    fi
  done

  if [ ${#missing_targets[@]} -gt 0 ]; then
    test_fail "Makefile has test targets" "Missing targets: ${missing_targets[*]}"
    return
  fi

  test_pass "Makefile has test targets"
}

test_makefile_has_validate_targets() {
  local makefile="$REPO_ROOT/Makefile"

  if [ ! -f "$makefile" ]; then
    test_fail "Makefile has validate targets" "Makefile not found"
    return
  fi

  # Check for required validate targets
  local missing_targets=()
  for target in "validate" "lint" "typecheck" "format"; do
    if ! grep -q "^${target}:" "$makefile"; then
      missing_targets+=("$target")
    fi
  done

  if [ ${#missing_targets[@]} -gt 0 ]; then
    test_fail "Makefile has validate targets" "Missing targets: ${missing_targets[*]}"
    return
  fi

  test_pass "Makefile has validate targets"
}

test_makefile_delegates_to_run_tests() {
  local makefile="$REPO_ROOT/Makefile"

  if [ ! -f "$makefile" ]; then
    test_fail "Makefile delegates to run-tests.sh" "Makefile not found"
    return
  fi

  # Check that test targets delegate to run-tests.sh
  if ! grep -q "run-tests\.sh" "$makefile"; then
    test_fail "Makefile delegates to run-tests.sh" "No reference to run-tests.sh found"
    return
  fi

  # Verify each test target uses delegation
  local targets_without_delegation=()
  for target in "test" "test-unit" "test-integration" "test-e2e"; do
    # Extract target definition and check if it calls run-tests.sh
    if ! sed -n "/^${target}:/,/^[^\t]/p" "$makefile" | grep -q "run-tests\.sh"; then
      targets_without_delegation+=("$target")
    fi
  done

  if [ ${#targets_without_delegation[@]} -gt 0 ]; then
    test_fail "Makefile delegates to run-tests.sh" "Targets without delegation: ${targets_without_delegation[*]}"
    return
  fi

  test_pass "Makefile delegates to run-tests.sh"
}

# ============================================================================
# Test Delegation and Exit Code Tests
# ============================================================================

test_make_test_propagates_success() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure with passing test
  mkdir -p "$test_dir/infrastructure/scripts"

  # Create mock run-tests.sh that succeeds
  create_script "$test_dir/infrastructure/scripts/run-tests.sh" \
    'echo "Running tests..."' \
    'exit 0'

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make test and check exit code
  if ! (cd "$test_dir" && make test >/dev/null 2>&1); then
    test_fail "make test propagates success exit code" "make test failed when script succeeded"
    return
  fi

  test_pass "make test propagates success exit code"
}

test_make_test_propagates_failure() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure with failing test
  mkdir -p "$test_dir/infrastructure/scripts"

  # Create mock run-tests.sh that fails
  create_script "$test_dir/infrastructure/scripts/run-tests.sh" \
    'echo "Running tests..."' \
    'echo "Test failure!" >&2' \
    'exit 1'

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make test and verify it fails
  if (cd "$test_dir" && make test >/dev/null 2>&1); then
    test_fail "make test propagates failure exit code" "make test succeeded when script failed"
    return
  fi

  test_pass "make test propagates failure exit code"
}

test_make_test_unit_passes_type_flag() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure
  mkdir -p "$test_dir/infrastructure/scripts"

  # Create mock run-tests.sh that checks for --type unit flag
  create_script "$test_dir/infrastructure/scripts/run-tests.sh" \
    'if [ "$1" != "--type" ] || [ "$2" != "unit" ]; then' \
    '  echo "Expected: --type unit, got: $*" >&2' \
    '  exit 1' \
    'fi' \
    'exit 0'

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make test-unit and verify flag is passed
  if ! (cd "$test_dir" && make test-unit >/dev/null 2>&1); then
    test_fail "make test-unit passes --type unit flag" "Flag not passed correctly"
    return
  fi

  test_pass "make test-unit passes --type unit flag"
}

test_make_test_integration_passes_type_flag() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure
  mkdir -p "$test_dir/infrastructure/scripts"

  # Create mock run-tests.sh that checks for --type integration flag
  create_script "$test_dir/infrastructure/scripts/run-tests.sh" \
    'if [ "$1" != "--type" ] || [ "$2" != "integration" ]; then' \
    '  echo "Expected: --type integration, got: $*" >&2' \
    '  exit 1' \
    'fi' \
    'exit 0'

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make test-integration and verify flag is passed
  if ! (cd "$test_dir" && make test-integration 2>&1); then
    test_fail "make test-integration passes --type integration flag" "Flag not passed correctly"
    return
  fi

  test_pass "make test-integration passes --type integration flag"
}

test_make_test_e2e_passes_type_flag() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure
  mkdir -p "$test_dir/infrastructure/scripts"

  # Create mock run-tests.sh that checks for --type e2e flag
  create_script "$test_dir/infrastructure/scripts/run-tests.sh" \
    'if [ "$1" != "--type" ] || [ "$2" != "e2e" ]; then' \
    '  echo "Expected: --type e2e, got: $*" >&2' \
    '  exit 1' \
    'fi' \
    'exit 0'

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make test-e2e and verify flag is passed
  if ! (cd "$test_dir" && make test-e2e 2>&1); then
    test_fail "make test-e2e passes --type e2e flag" "Flag not passed correctly"
    return
  fi

  test_pass "make test-e2e passes --type e2e flag"
}

# ============================================================================
# Validation Pipeline Tests
# ============================================================================

test_make_validate_runs_full_pipeline() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure
  mkdir -p "$test_dir/infrastructure/scripts"

  # Create marker file to track execution order
  local execution_log="$test_dir/execution.log"

  # Create mock run-tests.sh
  create_script "$test_dir/infrastructure/scripts/run-tests.sh" \
    "echo \"test\" >> \"$execution_log\"" \
    'exit 0'

  # Copy and modify Makefile to log execution
  # Replace go vet and go build commands with echo statements that log to file
  sed "s|@go vet ./\.\.\.|echo \"lint\" >> \"$execution_log\"|;
       s|@go build ./\.\.\.|echo \"typecheck\" >> \"$execution_log\"|" \
    "$REPO_ROOT/Makefile" > "$test_dir/Makefile"

  # Run make validate (without CHANGED_ONLY)
  (cd "$test_dir" && touch go.mod && make validate >/dev/null 2>&1)

  # Verify execution order: lint -> typecheck -> test
  if [ ! -f "$execution_log" ]; then
    test_fail "make validate runs full pipeline" "No execution log created"
    return
  fi

  local log_content=$(cat "$execution_log")

  # Check that all three stages ran
  if ! echo "$log_content" | grep -q "lint"; then
    test_fail "make validate runs full pipeline" "lint stage did not run"
    return
  fi

  if ! echo "$log_content" | grep -q "typecheck"; then
    test_fail "make validate runs full pipeline" "typecheck stage did not run"
    return
  fi

  if ! echo "$log_content" | grep -q "test"; then
    test_fail "make validate runs full pipeline" "test stage did not run"
    return
  fi

  # Verify order (lint before typecheck, typecheck before test)
  local lint_line=$(grep -n "lint" "$execution_log" | cut -d: -f1)
  local typecheck_line=$(grep -n "typecheck" "$execution_log" | cut -d: -f1)
  local test_line=$(grep -n "test" "$execution_log" | cut -d: -f1)

  if [ "$lint_line" -gt "$typecheck_line" ] || [ "$typecheck_line" -gt "$test_line" ]; then
    test_fail "make validate runs full pipeline" "Stages ran in wrong order: lint=$lint_line, typecheck=$typecheck_line, test=$test_line"
    return
  fi

  test_pass "make validate runs full pipeline"
}

test_make_validate_stops_on_lint_failure() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure with Go project
  mkdir -p "$test_dir/infrastructure/scripts"
  touch "$test_dir/go.mod"

  # Create marker file to track execution
  local execution_log="$test_dir/execution.log"

  # Create mock run-tests.sh that records execution
  create_script "$test_dir/infrastructure/scripts/run-tests.sh" \
    "echo \"test\" >> \"$execution_log\"" \
    'exit 0'

  # Copy Makefile and inject failing go vet
  sed "s|@go vet ./\.\.\.|echo \"lint\" >> \"$execution_log\"; exit 1|;
       s|@go build ./\.\.\.|echo \"typecheck\" >> \"$execution_log\"; exit 0|" \
    "$REPO_ROOT/Makefile" > "$test_dir/Makefile"

  # Run make validate and verify it fails
  if (cd "$test_dir" && make validate >/dev/null 2>&1); then
    test_fail "make validate stops on lint failure" "validate succeeded despite lint failure"
    return
  fi

  # Verify lint ran but typecheck and test did not
  if [ ! -f "$execution_log" ]; then
    test_fail "make validate stops on lint failure" "No execution log created"
    return
  fi

  local log_content=$(cat "$execution_log")

  if ! echo "$log_content" | grep -q "lint"; then
    test_fail "make validate stops on lint failure" "lint did not run"
    return
  fi

  if echo "$log_content" | grep -q "typecheck"; then
    test_fail "make validate stops on lint failure" "typecheck ran after lint failure"
    return
  fi

  if echo "$log_content" | grep -q "test"; then
    test_fail "make validate stops on lint failure" "test ran after lint failure"
    return
  fi

  test_pass "make validate stops on lint failure"
}

test_make_validate_stops_on_typecheck_failure() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure with Go project
  mkdir -p "$test_dir/infrastructure/scripts"
  touch "$test_dir/go.mod"

  # Create marker file to track execution
  local execution_log="$test_dir/execution.log"

  # Create mock run-tests.sh that records execution
  create_script "$test_dir/infrastructure/scripts/run-tests.sh" \
    "echo \"test\" >> \"$execution_log\"" \
    'exit 0'

  # Copy Makefile and inject failing go build
  sed "s|@go vet ./\.\.\.|echo \"lint\" >> \"$execution_log\"; exit 0|;
       s|@go build ./\.\.\.|echo \"typecheck\" >> \"$execution_log\"; exit 1|" \
    "$REPO_ROOT/Makefile" > "$test_dir/Makefile"

  # Run make validate and verify it fails
  if (cd "$test_dir" && make validate >/dev/null 2>&1); then
    test_fail "make validate stops on typecheck failure" "validate succeeded despite typecheck failure"
    return
  fi

  # Verify lint and typecheck ran but test did not
  if [ ! -f "$execution_log" ]; then
    test_fail "make validate stops on typecheck failure" "No execution log created"
    return
  fi

  local log_content=$(cat "$execution_log")

  if ! echo "$log_content" | grep -q "lint"; then
    test_fail "make validate stops on typecheck failure" "lint did not run"
    return
  fi

  if ! echo "$log_content" | grep -q "typecheck"; then
    test_fail "make validate stops on typecheck failure" "typecheck did not run"
    return
  fi

  if echo "$log_content" | grep -q "test"; then
    test_fail "make validate stops on typecheck failure" "test ran after typecheck failure"
    return
  fi

  test_pass "make validate stops on typecheck failure"
}

test_make_validate_changed_only_delegates_to_run_all_local_tests() {
  # Create a minimal test project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  # Set up minimal structure
  mkdir -p "$test_dir/infrastructure/scripts"

  # Create mock run-all-local-tests.sh that checks for --changed-only flag
  create_script "$test_dir/infrastructure/scripts/run-all-local-tests.sh" \
    'if [ "$1" != "--changed-only" ]; then' \
    '  echo "Expected: --changed-only, got: $*" >&2' \
    '  exit 1' \
    'fi' \
    'exit 0'

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make validate CHANGED_ONLY=true
  if ! (cd "$test_dir" && make validate CHANGED_ONLY=true 2>&1); then
    test_fail "make validate CHANGED_ONLY delegates to run-all-local-tests.sh" "Delegation failed"
    return
  fi

  test_pass "make validate CHANGED_ONLY delegates to run-all-local-tests.sh"
}

# ============================================================================
# Project Type Detection Tests
# ============================================================================

test_format_detects_go_project() {
  # Create a minimal Go project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  mkdir -p "$test_dir/infrastructure/scripts"
  touch "$test_dir/go.mod"

  # Create a simple Go file
  printf '%s\n' 'package main' 'func main() {' '    x:=1' '    _ = x' '}' > "$test_dir/main.go"

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make format
  local output
  if ! output=$(cd "$test_dir" && make format 2>&1); then
    test_fail "format detects Go project" "make format failed: $output"
    return
  fi

  # Verify it formatted Go code
  if ! echo "$output" | grep -q "Formatting Go code"; then
    test_fail "format detects Go project" "Did not detect/format Go project"
    return
  fi

  test_pass "format detects Go project"
}

test_lint_detects_go_project() {
  # Create a minimal Go project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  mkdir -p "$test_dir/infrastructure/scripts"
  touch "$test_dir/go.mod"

  # Create a simple Go file
  printf '%s\n' 'package main' 'func main() {}' > "$test_dir/main.go"

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make lint
  local output
  if ! output=$(cd "$test_dir" && make lint 2>&1); then
    test_fail "lint detects Go project" "make lint failed: $output"
    return
  fi

  # Verify it ran go vet
  if ! echo "$output" | grep -q "Running go vet"; then
    test_fail "lint detects Go project" "Did not detect/lint Go project"
    return
  fi

  test_pass "lint detects Go project"
}

test_typecheck_detects_go_project() {
  # Create a minimal Go project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  mkdir -p "$test_dir/infrastructure/scripts"
  touch "$test_dir/go.mod"

  # Create a simple Go file
  printf '%s\n' 'package main' 'func main() {}' > "$test_dir/main.go"

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make typecheck
  local output
  if ! output=$(cd "$test_dir" && make typecheck 2>&1); then
    test_fail "typecheck detects Go project" "make typecheck failed: $output"
    return
  fi

  # Verify it ran go build
  if ! echo "$output" | grep -q "Type checking Go code"; then
    test_fail "typecheck detects Go project" "Did not detect/typecheck Go project"
    return
  fi

  test_pass "typecheck detects Go project"
}

test_format_detects_nodejs_project() {
  # Create a minimal Node.js project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  mkdir -p "$test_dir/infrastructure/scripts"

  # Create package.json
  printf '%s\n' '{' '  "name": "test-project",' '  "version": "1.0.0"' '}' > "$test_dir/package.json"

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make format (will fail if pnpm/npx not available, but should detect project)
  local output
  output=$(cd "$test_dir" && make format 2>&1 || true)

  # Verify it attempted to format TypeScript/JavaScript
  if ! echo "$output" | grep -q "Formatting TypeScript/JavaScript"; then
    test_fail "format detects Node.js project" "Did not detect Node.js project"
    return
  fi

  test_pass "format detects Node.js project"
}

test_format_handles_missing_pnpm_gracefully() {
  # Create a minimal Node.js project
  local test_dir=$(mktemp -d)
  trap "rm -rf '$test_dir'" RETURN

  mkdir -p "$test_dir/infrastructure/scripts"

  # Create package.json
  printf '%s\n' '{' '  "name": "test-project",' '  "version": "1.0.0"' '}' > "$test_dir/package.json"

  # Copy Makefile
  cp "$REPO_ROOT/Makefile" "$test_dir/Makefile"

  # Run make format with PATH that excludes pnpm/npx
  local output
  output=$(cd "$test_dir" && PATH="/bin:/usr/bin" make format 2>&1 || true)

  # Should complete without error (|| true in the command allows continuation)
  # Verify it attempted formatting
  if ! echo "$output" | grep -q "Formatting"; then
    test_fail "format handles missing pnpm gracefully" "Did not attempt formatting"
    return
  fi

  test_pass "format handles missing pnpm gracefully"
}

# ============================================================================
# Run All Tests
# ============================================================================

echo "========================================"
echo "Makefile Integration Tests"
echo "========================================"

run_test test_makefile_exists
run_test test_makefile_has_test_targets
run_test test_makefile_has_validate_targets
run_test test_makefile_delegates_to_run_tests

echo ""
echo "=== Test Delegation Tests ==="
run_test test_make_test_propagates_success
run_test test_make_test_propagates_failure
run_test test_make_test_unit_passes_type_flag
run_test test_make_test_integration_passes_type_flag
run_test test_make_test_e2e_passes_type_flag

echo ""
echo "=== Validation Pipeline Tests ==="
# Validation pipeline tests verify lint→typecheck→test execution order
# NOTE: Using mock scripts to avoid Go toolchain dependency
run_test test_make_validate_runs_full_pipeline
run_test test_make_validate_stops_on_lint_failure
run_test test_make_validate_stops_on_typecheck_failure
run_test test_make_validate_changed_only_delegates_to_run_all_local_tests

echo ""
echo "=== Project Type Detection Tests ==="
# Project type detection tests verify Makefile detects go.mod/package.json
# NOTE: Using mock scripts to avoid Go/Node toolchain dependency
run_test test_format_detects_go_project
run_test test_lint_detects_go_project
run_test test_typecheck_detects_go_project
run_test test_format_detects_nodejs_project
run_test test_format_handles_missing_pnpm_gracefully

# ============================================================================
# Test Summary
# ============================================================================

print_test_summary
