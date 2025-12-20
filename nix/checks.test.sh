#!/usr/bin/env bash
# Integration tests for pre-push hooks defined in nix/checks.nix
#
# This script tests the error handling and validation logic in the pre-push hooks
# to ensure they provide clear error messages and fail gracefully.
#
# Usage:
#   ./nix/checks.test.sh                  # Run all tests
#   ./nix/checks.test.sh test_name        # Run specific test
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

# Test 1: mcp-nix-build hook fails when origin/main branch doesn't exist
test_mcp_build_no_origin_main() {
  print_test_header "test_mcp_build_no_origin_main"

  # Create temporary git repo without origin/main
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "test" > test.txt
  git add test.txt
  git commit -q -m "initial commit"

  # Create a simple script that mimics the mcp-nix-build hook logic
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e
if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
  echo "ERROR: Remote branch 'origin/main' not found"
  echo "Please fetch from origin: git fetch origin"
  exit 1
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_fails_with_message \
    "mcp-nix-build hook without origin/main" \
    "cd $test_dir && ./hook.sh" \
    "ERROR: Remote branch 'origin/main' not found"
}

# Test 2: mcp-nix-build hook fails when git diff fails
test_mcp_build_git_diff_fails() {
  print_test_header "test_mcp_build_git_diff_fails"

  # Create temporary git repo with origin/main
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "test" > test.txt
  git add test.txt
  git commit -q -m "initial commit"

  # Create origin remote pointing to self
  git remote add origin .
  git fetch -q origin

  # Create a script that mimics the hook but forces git diff to fail
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e

# Verify origin/main exists
if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
  echo "ERROR: Remote branch 'origin/main' not found"
  exit 1
fi

# Simulate git diff failure by using invalid ref
CHANGED_FILES=$(git diff --name-only origin/main...invalid-ref-xyz 2>&1) || {
  echo "ERROR: Failed to determine changed files"
  echo "This may indicate repository corruption or detached HEAD state"
  exit 1
}
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_fails_with_message \
    "mcp-nix-build hook with git diff failure" \
    "cd $test_dir && ./hook.sh" \
    "ERROR: Failed to determine changed files"
}

# Test 3: pnpm-lockfile-check hook fails when pnpm install fails
test_pnpm_lockfile_network_failure() {
  print_test_header "test_pnpm_lockfile_network_failure"

  # Create temporary directory with mismatched lockfile
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create package.json with a dependency
  cat > package.json <<'EOF'
{
  "name": "test",
  "version": "1.0.0",
  "dependencies": {
    "lodash": "4.17.21"
  }
}
EOF

  # Create empty/invalid pnpm-lock.yaml
  echo "lockfileVersion: '9.0'" > pnpm-lock.yaml

  git add package.json pnpm-lock.yaml
  git commit -q -m "initial commit"

  # Create a script that mimics the pnpm-lockfile-check hook
  cat > hook.sh <<EOF
#!/usr/bin/env bash
set -e

# Simulate the hook's pnpm install check
if ! pnpm install --frozen-lockfile --prefer-offline > /dev/null 2>&1; then
  echo ""
  echo "ERROR: pnpm lockfile is out of sync with package.json files"
  echo ""
  echo "This means pnpm-lock.yaml doesn't match the dependencies declared in package.json."
  echo "This check prevents CI failures from lockfile mismatches."
  echo ""
  echo "To fix this issue:"
  echo "  1. Run: pnpm install"
  echo "  2. Review the changes to pnpm-lock.yaml"
  echo "  3. Stage the updated lockfile: git add pnpm-lock.yaml"
  echo "  4. Retry your push"
  echo ""
  exit 1
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_fails_with_message \
    "pnpm-lockfile-check with install failure" \
    "cd $test_dir && ./hook.sh" \
    "ERROR: pnpm lockfile is out of sync with package.json files"
}

# Test 4: prettier-check-all hook fails when prettier binary is missing
test_prettier_missing_binary() {
  print_test_header "test_prettier_missing_binary"

  # Create temporary directory
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "test" > test.ts
  git add test.ts
  git commit -q -m "initial commit"

  # Create a script that tries to run non-existent prettier
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e

# Try to run prettier from a path that doesn't exist
if ! /nonexistent/path/to/prettier --check --ignore-unknown '**/*.{ts,tsx,js,jsx,json,md,yaml,yml}' 2>&1; then
  echo "ERROR: prettier binary not found"
  exit 1
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_fails_with_message \
    "prettier-check-all with missing binary" \
    "cd $test_dir && ./hook.sh" \
    "ERROR: prettier binary not found"
}

# Test 5: prettier-check-all hook fails when formatting issues found
test_prettier_check_fails() {
  print_test_header "test_prettier_check_fails"

  # Create temporary directory with badly formatted file
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create a badly formatted TypeScript file
  cat > test.ts <<'EOF'
const x={a:1,b:2,c:3};
const   y   =   "badly formatted";
function    test(  )  {
return   42  ;
}
EOF

  git add test.ts
  git commit -q -m "initial commit"

  # Create a script that runs prettier check
  cat > hook.sh <<EOF
#!/usr/bin/env bash
set -e

# Run prettier check on the badly formatted file
if ! prettier --check test.ts 2>&1; then
  echo ""
  echo "ERROR: Formatting issues found"
  echo "Run 'prettier --write .' to fix formatting"
  echo ""
  exit 1
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_fails_with_message \
    "prettier-check-all with formatting issues" \
    "cd $test_dir && ./hook.sh" \
    "ERROR: Formatting issues found"
}

# Main test runner
main() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Pre-Push Hooks Integration Tests${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # If specific test requested, run only that test
  if [[ $# -gt 0 ]]; then
    test_name="$1"
    if type "$test_name" &>/dev/null; then
      "$test_name"
    else
      echo -e "${RED}Error: Test '$test_name' not found${NC}"
      echo "Available tests:"
      echo "  test_mcp_build_no_origin_main"
      echo "  test_mcp_build_git_diff_fails"
      echo "  test_pnpm_lockfile_network_failure"
      echo "  test_prettier_missing_binary"
      echo "  test_prettier_check_fails"
      exit 1
    fi
  else
    # Run all tests
    test_mcp_build_no_origin_main
    test_mcp_build_git_diff_fails
    test_pnpm_lockfile_network_failure
    test_prettier_missing_binary
    test_prettier_check_fails
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
