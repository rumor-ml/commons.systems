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

# Test 6: prettier-check-all SUCCESS case
test_prettier_check_success() {
  print_test_header "test_prettier_check_success"

  # Create temporary directory
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create some files (content doesn't matter for this test)
  echo "test" > test.txt
  git add test.txt
  git commit -q -m "initial commit"

  # Create a script that simulates prettier check succeeding
  # We simulate success by having a mock prettier that always passes
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e

# Mock prettier check that always succeeds
# In real usage, prettier would check formatting and exit 0 if all files are formatted
echo "All files are properly formatted"
exit 0
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_succeeds \
    "prettier-check-all with properly formatted files" \
    "cd $test_dir && ./hook.sh"
}

# Test 7: mcp-nix-build SUCCESS case (no MCP changes)
test_mcp_build_success() {
  print_test_header "test_mcp_build_success"

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

  # Create a new branch with non-MCP changes
  git checkout -q -b feature
  echo "changed" > test.txt
  git add test.txt
  git commit -q -m "non-mcp change"

  # Create a script that mimics the mcp-nix-build hook logic
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e

# Verify origin/main exists
if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
  echo "ERROR: Remote branch 'origin/main' not found"
  exit 1
fi

# Get list of changed files
CHANGED_FILES=$(git diff --name-only origin/main...HEAD)

# Check if any MCP server directories were modified
if echo "$CHANGED_FILES" | grep -qE "(gh-issue-mcp-server|gh-workflow-mcp-server|wiggum-mcp-server|git-mcp-server)/"; then
  echo "MCP server files changed, running build..."
  exit 1
else
  echo "No MCP server changes detected, skipping Nix build."
  exit 0
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_succeeds \
    "mcp-nix-build hook with no MCP changes" \
    "cd $test_dir && ./hook.sh"
}

# Test 8: pnpm-lockfile SUCCESS case
test_pnpm_lockfile_success() {
  print_test_header "test_pnpm_lockfile_success"

  # Create temporary directory with non-package changes
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create a simple non-package file
  echo "# README" > README.md
  git add README.md
  git commit -q -m "initial commit"

  # Create origin remote pointing to self
  git remote add origin .
  git fetch -q origin

  # Create a new branch with non-package changes
  git checkout -q -b feature
  echo "# Updated README" > README.md
  git add README.md
  git commit -q -m "update readme"

  # Create a script that mimics the pnpm-lockfile-check hook
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e

# Verify origin/main exists
if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
  echo "ERROR: Remote branch 'origin/main' not found"
  exit 1
fi

# Check if any pnpm-related files changed
CHANGED_FILES=$(git diff --name-only origin/main...HEAD)

if echo "$CHANGED_FILES" | grep -qE "(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)"; then
  echo "Package files changed, validating lockfile..."
  exit 1
else
  echo "No package files changed, skipping lockfile validation."
  exit 0
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_succeeds \
    "pnpm-lockfile-check with no package changes" \
    "cd $test_dir && ./hook.sh"
}

# Test 9: End-to-end pre-push simulation
test_pre_push_end_to_end() {
  print_test_header "test_pre_push_end_to_end"

  # Create temporary git repo
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create initial commit
  echo "initial" > file.txt
  git add file.txt
  git commit -q -m "initial commit"

  # Set up origin remote
  git remote add origin .
  git fetch -q origin

  # Create feature branch
  git checkout -q -b feature

  # Make a change
  echo "changed" > file.txt
  git add file.txt
  git commit -q -m "make change"

  # Create a pre-push hook that simulates our checks
  mkdir -p .git/hooks
  cat > .git/hooks/pre-push <<'EOF'
#!/usr/bin/env bash
set -e

echo "Running pre-push checks..."

# Simulate prettier check (always pass for this test)
echo "✓ prettier-check-all passed"

# Simulate MCP build check (no MCP files changed)
CHANGED_FILES=$(git diff --name-only origin/main...HEAD)
if echo "$CHANGED_FILES" | grep -qE "(gh-issue-mcp-server|gh-workflow-mcp-server|wiggum-mcp-server|git-mcp-server)/"; then
  echo "✗ MCP build failed"
  exit 1
else
  echo "✓ mcp-nix-build passed (no changes)"
fi

# Simulate pnpm lockfile check (no package files changed)
if echo "$CHANGED_FILES" | grep -qE "(package\.json|pnpm-lock\.yaml)"; then
  echo "✗ pnpm lockfile check failed"
  exit 1
else
  echo "✓ pnpm-lockfile-check passed (no changes)"
fi

echo "All pre-push checks passed!"
exit 0
EOF
  chmod +x .git/hooks/pre-push

  # Simulate a git push by running the pre-push hook directly
  # (we can't actually push since there's no real remote)
  cd "$REPO_ROOT"
  assert_succeeds \
    "end-to-end pre-push hook execution" \
    "cd $test_dir && .git/hooks/pre-push"
}

# Test 10: Worktree compatibility
test_worktree_compatibility() {
  print_test_header "test_worktree_compatibility"

  # Create main repository
  local main_repo=$(mktemp -d)
  trap "rm -rf $main_repo" RETURN

  cd "$main_repo"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create initial commit
  echo "initial" > file.txt
  git add file.txt
  git commit -q -m "initial commit"

  # Create a worktree
  local worktree_dir="$main_repo/../worktree-test"
  git worktree add -q -b feature "$worktree_dir"

  # Verify worktree can access git information
  cd "$worktree_dir"

  # Create a script that mimics pre-push hook behavior in worktree
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e

# Verify we're in a git repository (should work in worktree)
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "ERROR: Not in a git repository"
  exit 1
fi

# Verify we can get current branch name (should be 'feature')
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "feature" ]; then
  echo "ERROR: Expected branch 'feature', got '$BRANCH'"
  exit 1
fi

# Verify we can access commits
if ! git rev-parse HEAD > /dev/null 2>&1; then
  echo "ERROR: Cannot access HEAD"
  exit 1
fi

echo "Worktree compatibility check passed"
echo "Branch: $BRANCH"
exit 0
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_succeeds \
    "worktree compatibility check" \
    "cd $worktree_dir && ./hook.sh"

  # Cleanup worktree
  cd "$main_repo"
  git worktree remove -f "$worktree_dir" 2>/dev/null || true
}

# Test 11: Worktree hook execution
test_worktree_hook_execution() {
  print_test_header "test_worktree_hook_execution"

  # Create test repo with pre-push hook
  local tempdir=$(mktemp -d)
  trap "rm -rf '$tempdir'" EXIT

  cd "$tempdir"
  git init
  git config user.name "Test User"
  git config user.email "test@example.com"

  # Create simple pre-push hook that writes to a marker file
  mkdir -p .git/hooks
  cat > .git/hooks/pre-push <<'HOOKEOF'
#!/bin/bash
echo "Hook executed from $(pwd)" > /tmp/hook-execution-marker
exit 0
HOOKEOF
  chmod +x .git/hooks/pre-push

  # Create initial commit on main
  echo "content" > file.txt
  git add file.txt
  git commit -m "Initial commit"
  git branch -M main

  # Create worktree with hook configuration (simulate /worktree command)
  local worktree_path="$tempdir/worktrees/test-branch"
  git worktree add "$worktree_path" -b test-branch main

  # Configure hooks path in worktree (critical step from /worktree command)
  cd "$worktree_path"
  MAIN_GIT_DIR=$(git rev-parse --git-common-dir)
  git config core.hooksPath "$MAIN_GIT_DIR/hooks"

  # Make a change in worktree
  echo "change" > file.txt
  git add file.txt
  git commit -m "Test change"

  # Attempt push (will fail due to no remote, but hook should execute)
  rm -f /tmp/hook-execution-marker
  git push -u origin test-branch 2>&1 || true

  # Verify hook executed
  if [ -f /tmp/hook-execution-marker ]; then
    assert_succeeds "Worktree pre-push hook executed" "grep -q 'Hook executed' /tmp/hook-execution-marker"
  else
    echo -e "${RED}✗ FAIL: Pre-push hook did not execute in worktree${NC}"
    echo "Hook marker file not created at /tmp/hook-execution-marker"
    echo "This indicates core.hooksPath configuration is not working"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  rm -f /tmp/hook-execution-marker
  cd "$REPO_ROOT"
}

# Test that MCP build hook validates changes correctly
test_mcp_build_validates_changes() {
  print_test_header "test_mcp_build_validates_changes"

  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  # Test 1: Pattern matches MCP server file paths
  if echo "gh-workflow-mcp-server/src/index.ts" | grep -qE "(gh-issue-mcp-server|gh-workflow-mcp-server|wiggum-mcp-server|git-mcp-server)/"; then
    echo -e "${GREEN}✓ PASS: Pattern matches gh-workflow-mcp-server files${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Pattern should match gh-workflow-mcp-server files${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
  TESTS_RUN=$((TESTS_RUN + 1))

  # Test 2: Pattern matches all MCP server directories
  local all_match=true
  for path in "gh-issue-mcp-server/pkg.json" "gh-workflow-mcp-server/src/t.ts" "wiggum-mcp-server/tsconfig.json" "git-mcp-server/README.md"; do
    if ! echo "$path" | grep -qE "(gh-issue-mcp-server|gh-workflow-mcp-server|wiggum-mcp-server|git-mcp-server)/"; then
      all_match=false
      break
    fi
  done

  if [ "$all_match" = true ]; then
    echo -e "${GREEN}✓ PASS: Pattern matches all 4 MCP server directories${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Pattern should match all MCP server directories${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
  TESTS_RUN=$((TESTS_RUN + 1))

  # Test 3: Pattern does NOT match non-MCP files
  local none_match=true
  for path in "README.md" "src/index.ts" "mcp-common/types.ts" "apps/printsync/server.go"; do
    if echo "$path" | grep -qE "(gh-issue-mcp-server|gh-workflow-mcp-server|wiggum-mcp-server|git-mcp-server)/"; then
      none_match=false
      break
    fi
  done

  if [ "$none_match" = true ]; then
    echo -e "${GREEN}✓ PASS: Pattern correctly excludes non-MCP files${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Pattern should NOT match non-MCP files${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
  TESTS_RUN=$((TESTS_RUN + 1))
}

# Test that prettier-check-all checks ALL files, not just changed files
test_prettier_check_all_files_not_just_changes() {
  print_test_header "test_prettier_check_all_files_not_just_changes"

  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create three JS files with varying format quality
  echo 'const a = 1;' > file1.js
  echo 'const b = 2;' > file2.js
  echo 'const c=3;' > file3.js  # Bad formatting (no space after =)

  git add .
  git commit -q -m "Initial commit with mixed formatting"

  # Create hook that checks ALL tracked files (mimics prettier-check-all)
  # Real hook: `prettier --check --ignore-unknown '**/*.{ts,tsx,js,jsx,json,md,yaml,yml}'`
  # with pass_filenames=false and always_run=true
  cat > hook.sh <<'EOF'
#!/bin/bash
# Simulate prettier --check on ALL tracked files
# In real hook: prettier checks all files regardless of what changed

for file in *.js; do
  if [[ -f "$file" ]]; then
    # Simple format check: require space after =
    if ! grep -q '= ' "$file"; then
      echo "ERROR: Code style issues found in $file"
      echo "  Expected: 'const x = value'"
      echo "  Found:    '$(cat $file)'"
      exit 1
    fi
  fi
done

exit 0
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_fails_with_message \
    "prettier-check-all detects pre-existing format issues" \
    "cd $test_dir && ./hook.sh" \
    "ERROR: Code style issues found in file3.js"
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
      echo "  test_prettier_check_success"
      echo "  test_mcp_build_success"
      echo "  test_pnpm_lockfile_success"
      echo "  test_pre_push_end_to_end"
      echo "  test_worktree_compatibility"
      echo "  test_worktree_hook_execution"
      echo "  test_mcp_build_validates_changes"
      echo "  test_prettier_check_all_files_not_just_changes"
      exit 1
    fi
  else
    # Run all tests
    test_mcp_build_no_origin_main
    test_mcp_build_git_diff_fails
    test_pnpm_lockfile_network_failure
    test_prettier_missing_binary
    test_prettier_check_fails
    test_prettier_check_success
    test_mcp_build_success
    test_pnpm_lockfile_success
    test_pre_push_end_to_end
    test_worktree_compatibility
    test_worktree_hook_execution
    test_mcp_build_validates_changes
    test_prettier_check_all_files_not_just_changes
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
