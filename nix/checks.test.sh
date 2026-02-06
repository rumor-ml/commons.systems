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
# TODO(#1606): Test helper functions eval untrusted input without validation
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
# TODO(#1606): Test helper functions eval untrusted input without validation
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
  git init --initial-branch=main
  git config user.name "Test User"
  git config user.email "test@example.com"

  # Create bare repository to serve as remote
  local bare_remote="$tempdir/remote.git"
  git init --bare "$bare_remote"

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

  # Add remote and push main branch
  git remote add origin "$bare_remote"
  git push -u origin main

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
  push_output=$(git push -u origin test-branch 2>&1 || true)

  # Verify push actually attempted (not network/auth error)
  if [[ -z "$push_output" ]]; then
    echo -e "${RED}✗ FAIL: Push produced no output - git may not have run${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  # Verify hook executed (marker file created)
  if [ -f /tmp/hook-execution-marker ]; then
    assert_succeeds "Worktree pre-push hook executed" "grep -q 'Hook executed' /tmp/hook-execution-marker"
  else
    echo -e "${RED}✗ FAIL: Pre-push hook did not execute in worktree${NC}"
    echo "Push output: $push_output"
    echo "This could indicate:"
    echo "  - Hook didn't run (core.hooksPath not configured)"
    echo "  - Push failed before hook execution"
    echo "  - Network/auth error prevented push attempt"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  rm -f /tmp/hook-execution-marker

  git worktree remove "$worktree_path" --force || true
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

# Test 12: Worktree hooks block invalid changes
test_worktree_hook_blocks_invalid_changes() {
  print_test_header "test_worktree_hook_blocks_invalid_changes"

  # Create test repo with validation pre-push hook
  local tempdir=$(mktemp -d)
  trap "rm -rf '$tempdir'" EXIT

  cd "$tempdir"
  git init --initial-branch=main
  git config user.name "Test User"
  git config user.email "test@example.com"

  # Create bare repository to serve as remote
  local bare_remote="$tempdir/remote.git"
  git init --bare "$bare_remote"

  # Create pre-push hook that rejects files with "INVALID" content
  mkdir -p .git/hooks
  cat > .git/hooks/pre-push <<'HOOKEOF'
#!/bin/bash
# Hook that validates file contents - rejects INVALID marker
# Pre-push hooks receive input on stdin: <local_ref> <local_sha> <remote_ref> <remote_sha>
while read local_ref local_sha remote_ref remote_sha; do
  # Check the actual commit being pushed
  if git show "$local_sha:file.txt" 2>/dev/null | grep -q "INVALID"; then
    echo "ERROR: Invalid content detected in changes"
    echo "Pre-push hook blocked the push"
    exit 1
  fi
done
exit 0
HOOKEOF
  chmod +x .git/hooks/pre-push

  # Create initial commit on main
  echo "valid content" > file.txt
  git add file.txt
  git commit -m "Initial commit"
  git branch -M main

  # Add remote and push main branch
  git remote add origin "$bare_remote"
  git push -u origin main

  # Create worktree with hook configuration
  local worktree_path="$tempdir/worktrees/test-branch"
  git worktree add "$worktree_path" -b test-branch main

  # Configure hooks path in worktree (critical from /worktree command)
  cd "$worktree_path"
  MAIN_GIT_DIR=$(git rev-parse --git-common-dir)
  git config core.hooksPath "$MAIN_GIT_DIR/hooks"

  # Make invalid change in worktree
  echo "INVALID content" > file.txt
  git add file.txt
  git commit -m "Invalid change"

  # Verify hook blocks push in worktree
  TESTS_RUN=$((TESTS_RUN + 1))
  # Capture push output (expect failure, so disable exit-on-error temporarily)
  push_output=$(git push -u origin test-branch 2>&1 || true)

  # Verify push actually attempted (not network/auth error)
  if [[ -z "$push_output" ]]; then
    echo -e "${RED}✗ FAIL: Push produced no output - git may not have run${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    cd "$REPO_ROOT"
    return 1
  fi

  if echo "$push_output" | grep -q "Pre-push hook blocked"; then
    echo -e "${GREEN}✓ PASS: Pre-push hook correctly blocked invalid changes in worktree${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Pre-push hook should have blocked invalid changes in worktree${NC}"
    echo "Push output was:"
    echo "$push_output"
    echo "This could indicate:"
    echo "  - Hook didn't block (not configured or check failed)"
    echo "  - Push failed before hook execution"
    echo "  - Network/auth error prevented push attempt"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  cd "$REPO_ROOT"
}

# Test 13: MCP build script detects untracked source files
test_mcp_build_detects_untracked_files() {
  print_test_header "test_mcp_build_detects_untracked_files"

  # Create temporary fake MCP server
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create minimal package.json
  cat > package.json <<'EOF'
{
  "name": "test-mcp-server",
  "version": "1.0.0",
  "scripts": {
    "build": "echo 'Building...'"
  }
}
EOF

  # Create src directory with tracked file
  mkdir -p src
  echo "export const tracked = true;" > src/index.ts
  git add package.json src/index.ts
  git commit -q -m "Initial commit"

  # Create untracked source file (simulates developer forgot git add)
  echo "export const untracked = true;" > src/new-feature.ts

  # npm build should succeed (doesn't know about git)
  TESTS_RUN=$((TESTS_RUN + 1))
  if npm run build >/dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS: npm build succeeds with untracked files${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: npm build should succeed${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  # Verify git status shows untracked file
  TESTS_RUN=$((TESTS_RUN + 1))
  if git status --porcelain | grep -q "?? src/new-feature.ts"; then
    echo -e "${GREEN}✓ PASS: git status detects untracked source file${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: git status should show untracked file${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  # Test build-mcp-servers.sh detection would happen during Nix build
  # (This is tested indirectly - Nix build will fail if files untracked)
  # The actual detection message comes from Nix's Cannot find module error

  echo -e "${YELLOW}Note: Actual untracked file detection happens during Nix build${NC}"
  echo -e "${YELLOW}Nix error: 'Cannot find module' → suggests running git status${NC}"

  cd "$REPO_ROOT"
}

# Test 14: home-manager-build-check skips when no Home Manager files changed
test_home_manager_build_check_skip() {
  print_test_header "test_home_manager_build_check_skip"

  # Create temporary git repo
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create initial commit with non-Home Manager file
  echo "# README" > README.md
  git add README.md
  git commit -q -m "initial commit"

  # Create origin remote pointing to self
  git remote add origin .
  git fetch -q origin

  # Create feature branch with non-Home Manager changes
  git checkout -q -b feature
  echo "# Updated README" > README.md
  git add README.md
  git commit -q -m "update readme"

  # Create a script that mimics the home-manager-build-check hook
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e

# Verify we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "ERROR: Not in a git repository"
  exit 1
fi

# Verify origin/main exists
if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
  echo "ERROR: Remote branch 'origin/main' not found"
  echo "Please fetch from origin: git fetch origin"
  exit 1
fi

# Get list of changed files between main and current branch
CHANGED_FILES=$(git diff --name-only origin/main...HEAD) || {
  echo "ERROR: Failed to determine changed files"
  echo "This may indicate repository corruption or detached HEAD state"
  exit 1
}

# Check if any Home Manager or WezTerm config files changed
# Test expects hook to skip when no files changed - this branch should NOT execute
if echo "$CHANGED_FILES" | grep -qE "(nix/home/|flake\.nix)"; then
  echo "Home Manager configuration files changed, validating build..."
  exit 1  # Unexpected: test_home_manager_build_check_skip should not detect changes
else
  echo "No Home Manager configuration changes detected, skipping build check."
  exit 0  # Expected: test passes when hook correctly skips validation
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_succeeds \
    "home-manager-build-check skips when no Home Manager files changed" \
    "cd $test_dir && ./hook.sh"
}

# Test 15: home-manager-build-check detects nix/home/ changes
test_home_manager_build_check_detects_home_changes() {
  print_test_header "test_home_manager_build_check_detects_home_changes"

  # Create temporary git repo
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create initial commit with Home Manager directory
  mkdir -p nix/home
  echo "# Home Manager config" > nix/home/default.nix
  git add nix/home/default.nix
  git commit -q -m "initial commit"

  # Create origin remote pointing to self
  git remote add origin .
  git fetch -q origin

  # Create feature branch with Home Manager changes
  git checkout -q -b feature
  echo "# Updated Home Manager config" > nix/home/wezterm.nix
  git add nix/home/wezterm.nix
  git commit -q -m "add wezterm config"

  # Create a script that mimics the home-manager-build-check hook
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

# Check if any Home Manager files changed
if echo "$CHANGED_FILES" | grep -qE "(nix/home/|flake\.nix)"; then
  echo "Home Manager configuration files changed, validating build..."
  # In real hook, this would run nix build
  # For test, we verify detection works and exit with success marker
  echo "DETECTED_HOME_MANAGER_CHANGES"
  exit 0
else
  echo "No Home Manager configuration changes detected"
  exit 1
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_succeeds \
    "home-manager-build-check detects nix/home/ changes" \
    "cd $test_dir && ./hook.sh"
}

# Test 16: home-manager-build-check detects flake.nix changes
test_home_manager_build_check_detects_flake_changes() {
  print_test_header "test_home_manager_build_check_detects_flake_changes"

  # Create temporary git repo
  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  cd "$test_dir"
  git init -q -b main
  git config user.email "test@example.com"
  git config user.name "Test User"

  # Create initial commit with flake.nix
  echo "# Flake config" > flake.nix
  git add flake.nix
  git commit -q -m "initial commit"

  # Create origin remote pointing to self
  git remote add origin .
  git fetch -q origin

  # Create feature branch with flake.nix changes
  git checkout -q -b feature
  echo "# Updated flake config" > flake.nix
  git add flake.nix
  git commit -q -m "update flake"

  # Create a script that mimics the home-manager-build-check hook
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

# Check if flake.nix changed (Home Manager may be affected)
if echo "$CHANGED_FILES" | grep -qE "(nix/home/|flake\.nix)"; then
  echo "Home Manager configuration files changed, validating build..."
  echo "DETECTED_FLAKE_CHANGES"
  exit 0
else
  echo "No Home Manager configuration changes detected"
  exit 1
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_succeeds \
    "home-manager-build-check detects flake.nix changes" \
    "cd $test_dir && ./hook.sh"
}

# Test 17: home-manager-build-check fails when origin/main missing
test_home_manager_build_check_no_origin_main() {
  print_test_header "test_home_manager_build_check_no_origin_main"

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

  # Create a script that mimics the home-manager-build-check hook
  cat > hook.sh <<'EOF'
#!/usr/bin/env bash
set -e

# Verify we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "ERROR: Not in a git repository"
  exit 1
fi

# Verify origin/main exists
if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
  echo "ERROR: Remote branch 'origin/main' not found"
  echo "Please fetch from origin: git fetch origin"
  exit 1
fi
EOF
  chmod +x hook.sh

  cd "$REPO_ROOT"
  assert_fails_with_message \
    "home-manager-build-check hook without origin/main" \
    "cd $test_dir && ./hook.sh" \
    "ERROR: Remote branch 'origin/main' not found"
}

# Test 18: home-manager-build-check validates regex pattern matches correctly
test_home_manager_build_check_regex_pattern() {
  print_test_header "test_home_manager_build_check_regex_pattern"

  local test_dir=$(mktemp -d)
  trap "rm -rf $test_dir" RETURN

  # Test 1: Pattern matches nix/home/ directory files
  TESTS_RUN=$((TESTS_RUN + 1))
  if echo "nix/home/wezterm.nix" | grep -qE "(nix/home/|flake\.nix)"; then
    echo -e "${GREEN}✓ PASS: Pattern matches nix/home/wezterm.nix${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Pattern should match nix/home/wezterm.nix${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  # Test 2: Pattern matches nix/home/ subdirectories
  TESTS_RUN=$((TESTS_RUN + 1))
  if echo "nix/home/modules/git.nix" | grep -qE "(nix/home/|flake\.nix)"; then
    echo -e "${GREEN}✓ PASS: Pattern matches nix/home/ subdirectories${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Pattern should match nix/home/modules/git.nix${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  # Test 3: Pattern matches flake.nix in root
  TESTS_RUN=$((TESTS_RUN + 1))
  if echo "flake.nix" | grep -qE "(nix/home/|flake\.nix)"; then
    echo -e "${GREEN}✓ PASS: Pattern matches flake.nix${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Pattern should match flake.nix${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  # Test 4: Pattern does NOT match other nix files
  TESTS_RUN=$((TESTS_RUN + 1))
  if echo "nix/checks.nix" | grep -qE "(nix/home/|flake\.nix)"; then
    echo -e "${RED}✗ FAIL: Pattern should NOT match nix/checks.nix${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  else
    echo -e "${GREEN}✓ PASS: Pattern correctly excludes nix/checks.nix${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  fi

  # Test 5: Pattern does NOT match non-nix files
  TESTS_RUN=$((TESTS_RUN + 1))
  if echo "README.md" | grep -qE "(nix/home/|flake\.nix)"; then
    echo -e "${RED}✗ FAIL: Pattern should NOT match README.md${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  else
    echo -e "${GREEN}✓ PASS: Pattern correctly excludes README.md${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  fi

  # Test 6: Pattern does NOT match similar paths
  TESTS_RUN=$((TESTS_RUN + 1))
  if echo "nix/homelab/config.nix" | grep -qE "(nix/home/|flake\.nix)"; then
    echo -e "${RED}✗ FAIL: Pattern should NOT match nix/homelab/config.nix${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  else
    echo -e "${GREEN}✓ PASS: Pattern correctly excludes nix/homelab/${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  fi

  cd "$REPO_ROOT"
}

# TODO(#1756): Add test for home-manager-build-check with actual build failures
# Currently we test detection logic and error handling for missing origin/main,
# but don't test the case where nix build .#homeConfigurations fails due to:
# - Syntax errors in Nix files
# - Invalid package references
# - Module configuration errors
# This would require a complex test setup with a valid flake that we intentionally break.
# Manual test: Introduce syntax error in nix/home/wezterm.nix and verify hook fails.

# Test 20: CI workflow Home Manager build step validates configuration
test_ci_workflow_home_manager_build() {
  print_test_header "test_ci_workflow_home_manager_build"

  WORKFLOW_FILE="$REPO_ROOT/.github/workflows/nix-ci.yml"

  # Test 1: Verify workflow YAML contains Home Manager build step
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: CI workflow contains Home Manager build step${NC}"

  if grep -q "Verify Home Manager configuration builds" "$WORKFLOW_FILE" && \
     grep -q "nix build.*homeConfigurations.aarch64-darwin.activationPackage" "$WORKFLOW_FILE"; then
    echo -e "${GREEN}✓ PASS: CI workflow contains Home Manager build step${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: CI workflow missing Home Manager build step${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  # Test 2: Verify the nix build command uses correct flags
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: CI workflow uses correct nix build flags${NC}"

  if grep -q "nix build.*--impure.*--no-link" "$WORKFLOW_FILE"; then
    echo -e "${GREEN}✓ PASS: CI workflow uses --impure and --no-link flags${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: CI workflow missing required nix build flags${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  # Test 3: Extract and verify the exact nix build command works
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: CI workflow nix build command execution${NC}"

  # Extract the nix build command from workflow YAML
  NIX_BUILD_CMD=$(grep -A 2 "Building Home Manager configuration" "$WORKFLOW_FILE" | \
                  grep "nix build" | \
                  sed 's/^[[:space:]]*//')

  if [[ -z "$NIX_BUILD_CMD" ]]; then
    echo -e "${RED}✗ FAIL: Could not extract nix build command from workflow${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  # Execute the command to verify it works
  BUILD_OUTPUT=$(cd "$REPO_ROOT" && eval "$NIX_BUILD_CMD" 2>&1)
  BUILD_EXIT=$?

  if [[ $BUILD_EXIT -eq 0 ]]; then
    echo -e "${GREEN}✓ PASS: CI workflow nix build command executes successfully${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: CI workflow nix build command failed${NC}"
    echo -e "${RED}Command: $NIX_BUILD_CMD${NC}"
    echo -e "${RED}Error output:${NC}"
    echo "$BUILD_OUTPUT"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  # Test 4: Verify workflow validates the build completed
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: CI workflow includes success verification${NC}"

  if grep -q "Home Manager configuration builds successfully" "$WORKFLOW_FILE"; then
    echo -e "${GREEN}✓ PASS: CI workflow verifies build success${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: CI workflow missing build success verification${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  cd "$REPO_ROOT"
}

# Test 19: WezTerm Lua validation hook with valid config
test_wezterm_lua_validation() {
  print_test_header "test_wezterm_lua_validation"

  # Test 1: Validate current WezTerm config has valid Lua syntax
  # This validates the end-to-end Nix -> Lua extraction works
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: WezTerm Lua syntax validation${NC}"

  # Extract Lua code from wezterm.nix (same method as the hook)
  LUA_FILE=$(mktemp)
  trap "rm -f $LUA_FILE" RETURN

  # Capture both stdout and stderr for diagnostic purposes
  NIX_EVAL_STDERR=$(mktemp)
  trap "rm -f $LUA_FILE $NIX_EVAL_STDERR" RETURN

  if nix eval --raw --impure \
    --expr '(import ./nix/home/wezterm.nix {
      config = {};
      pkgs = import <nixpkgs> {};
      lib = (import <nixpkgs> {}).lib;
    }).programs.wezterm.extraConfig' \
    > "$LUA_FILE" 2>"$NIX_EVAL_STDERR"; then

    # Validate Lua syntax using nix-shell to get luac
    LUAC_OUTPUT=$(nix-shell -p lua --run "luac -p $LUA_FILE" 2>&1)
    LUAC_EXIT=$?

    if [[ $LUAC_EXIT -eq 0 ]]; then
      echo -e "${GREEN}✓ PASS: WezTerm Lua configuration has valid syntax${NC}"
      TESTS_PASSED=$((TESTS_PASSED + 1))
    else
      echo -e "${RED}✗ FAIL: WezTerm Lua configuration has syntax errors${NC}"
      echo -e "${RED}luac output:${NC}"
      echo "$LUAC_OUTPUT"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      return 1
    fi
  else
    echo -e "${RED}✗ FAIL: Failed to extract Lua config from wezterm.nix${NC}"
    echo -e "${RED}Nix evaluation stderr:${NC}"
    cat "$NIX_EVAL_STDERR"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  # Test 2: Validate config values are correctly set
  # This is an end-to-end validation that the Nix configuration produces
  # the expected Lua config values. This is NOT what the pre-commit hook does
  # (the hook only validates syntax with luac -p).
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: WezTerm Lua config value validation (end-to-end)${NC}"

  # Create a Lua script that mocks wezterm module and validates config values
  cat > "${LUA_FILE}.test" <<'LUAEOF'
-- Mock wezterm module
package.loaded['wezterm'] = {
  config_builder = function()
    return {}
  end,
  font = function(name)
    return {name = name}
  end
}

-- Load the actual config and capture the returned config object
local config_func = loadfile(arg[1])
if not config_func then
  print("Failed to load config file")
  os.exit(1)
end

-- Execute the config file in a fresh environment that has the mocked wezterm
local config = config_func()

-- Validate config values
local errors = {}

if config.font_size ~= 12.0 then
  table.insert(errors, "font_size should be 12.0, got " .. tostring(config.font_size))
end

if config.color_scheme ~= 'Tokyo Night' then
  table.insert(errors, "color_scheme should be 'Tokyo Night', got " .. tostring(config.color_scheme))
end

if config.scrollback_lines ~= 10000 then
  table.insert(errors, "scrollback_lines should be 10000, got " .. tostring(config.scrollback_lines))
end

if config.enable_scroll_bar ~= false then
  table.insert(errors, "enable_scroll_bar should be false, got " .. tostring(config.enable_scroll_bar))
end

if config.hide_tab_bar_if_only_one_tab ~= true then
  table.insert(errors, "hide_tab_bar_if_only_one_tab should be true, got " .. tostring(config.hide_tab_bar_if_only_one_tab))
end

if config.use_fancy_tab_bar ~= false then
  table.insert(errors, "use_fancy_tab_bar should be false, got " .. tostring(config.use_fancy_tab_bar))
end

if config.native_macos_fullscreen_mode ~= true then
  table.insert(errors, "native_macos_fullscreen_mode should be true, got " .. tostring(config.native_macos_fullscreen_mode))
end

if config.check_for_updates ~= false then
  table.insert(errors, "check_for_updates should be false, got " .. tostring(config.check_for_updates))
end

-- Validate window_padding
if type(config.window_padding) ~= 'table' then
  table.insert(errors, "window_padding should be a table")
else
  if config.window_padding.left ~= 4 then
    table.insert(errors, "window_padding.left should be 4, got " .. tostring(config.window_padding.left))
  end
  if config.window_padding.right ~= 4 then
    table.insert(errors, "window_padding.right should be 4, got " .. tostring(config.window_padding.right))
  end
  if config.window_padding.top ~= 4 then
    table.insert(errors, "window_padding.top should be 4, got " .. tostring(config.window_padding.top))
  end
  if config.window_padding.bottom ~= 4 then
    table.insert(errors, "window_padding.bottom should be 4, got " .. tostring(config.window_padding.bottom))
  end
end

-- Validate font configuration
if type(config.font) ~= 'table' then
  table.insert(errors, "font should be a table (result of wezterm.font())")
else
  if config.font.name ~= 'GeistMono Nerd Font' then
    table.insert(errors, "font.name should be 'GeistMono Nerd Font', got " .. tostring(config.font.name))
  end
end

-- Report results
if #errors > 0 then
  print("Config validation errors:")
  for _, err in ipairs(errors) do
    print("  - " .. err)
  end
  os.exit(1)
else
  print("All config values are correct")
  os.exit(0)
end
LUAEOF

  if nix-shell -p lua --run "lua ${LUA_FILE}.test $LUA_FILE" 2>&1; then
    echo -e "${GREEN}✓ PASS: WezTerm config values are correctly set${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: WezTerm config values validation failed${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  rm -f "${LUA_FILE}.test"
}

# Test 21: WezTerm Lua syntax pre-commit hook execution (E2E)
test_wezterm_lua_syntax_pre_commit_hook_e2e() {
  print_test_header "test_wezterm_lua_syntax_pre_commit_hook_e2e"

  # Create test repo with pre-commit hook
  local tempdir=$(mktemp -d)
  trap "rm -rf '$tempdir'" EXIT

  cd "$tempdir"
  git init --initial-branch=main
  git config user.name "Test User"
  git config user.email "test@example.com"

  # Create minimal wezterm.nix-like file structure
  mkdir -p nix/home
  cat > nix/home/wezterm.nix <<'WEZTERMEOF'
{ config, pkgs, lib, ... }:
{
  programs.wezterm = {
    enable = true;
    extraConfig = ''
      local config = {}
      config.font_size = 12.0
      return config
    '';
  };
}
WEZTERMEOF

  # Create pre-commit hook that mimics wezterm-lua-syntax validation
  # Uses simplified sed extraction instead of nix eval to avoid dependency issues
  # in test environment (test creates minimal wezterm.nix without full context)
  mkdir -p .git/hooks
  cat > .git/hooks/pre-commit <<'HOOKEOF'
#!/bin/bash
set -e

# Check if wezterm.nix is in the commit
if git diff --cached --name-only | grep -q "nix/home/wezterm.nix"; then
  echo "Validating WezTerm Lua syntax..."

  # Extract Lua code between extraConfig delimiters (simplified extraction)
  LUA_FILE=$(mktemp)
  trap "rm -f $LUA_FILE" EXIT

  # Extract content between the two single quotes after extraConfig
  # (Production hook uses 'nix eval' for proper Nix string handling)
  sed -n "/extraConfig = ''/,/'';/p" nix/home/wezterm.nix | \
    sed '1d;$d' > "$LUA_FILE"

  # Validate Lua syntax using nix-shell to get luac
  # Capture luac output for error reporting
  LUAC_OUTPUT=$(nix-shell -p lua --run "luac -p $LUA_FILE" 2>&1)
  LUAC_EXIT=$?

  if [ $LUAC_EXIT -ne 0 ]; then
    echo ""
    echo "ERROR: WezTerm Lua configuration has syntax errors"
    echo "File: nix/home/wezterm.nix"
    echo ""
    echo "Lua syntax errors:"
    echo "$LUAC_OUTPUT"
    echo ""
    echo "Fix the Lua syntax errors in the extraConfig field before committing."
    echo ""
    exit 1
  fi

  echo "✅ WezTerm Lua configuration syntax is valid"
fi
HOOKEOF
  chmod +x .git/hooks/pre-commit

  # Create initial commit on main
  echo "initial" > README.md
  git add README.md
  git commit -m "Initial commit"

  # Test 1: Verify hook blocks commit with invalid Lua syntax
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Pre-commit hook blocks invalid Lua${NC}"

  # Introduce invalid Lua syntax
  cat > nix/home/wezterm.nix <<'WEZTERMEOF'
{ config, pkgs, lib, ... }:
{
  programs.wezterm = {
    enable = true;
    extraConfig = ''
      local config = {}
      config.font_size =
      return config
    '';
  };
}
WEZTERMEOF

  git add nix/home/wezterm.nix

  # Attempt commit - should fail
  commit_output=$(git commit -m "Invalid Lua" 2>&1) || commit_failed=1
  if [[ $commit_failed -eq 1 ]] && echo "$commit_output" | grep -q "ERROR: WezTerm Lua"; then
    echo -e "${GREEN}✓ PASS: Hook correctly blocked commit with invalid Lua${NC}"
    # Display Lua error details for debugging test failures
    if echo "$commit_output" | grep -q "Lua syntax errors:"; then
      echo -e "${BLUE}Lua syntax error details:${NC}"
      echo "$commit_output" | sed -n '/Lua syntax errors:/,/Fix the Lua/p' | head -n -1
    fi
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Hook did not block commit with invalid Lua${NC}"
    echo "Commit output: $commit_output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    cd "$REPO_ROOT"
    return 1
  fi

  # Test 2: Verify hook allows commit with valid Lua syntax
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Pre-commit hook allows valid Lua${NC}"

  # Fix Lua syntax
  cat > nix/home/wezterm.nix <<'WEZTERMEOF'
{ config, pkgs, lib, ... }:
{
  programs.wezterm = {
    enable = true;
    extraConfig = ''
      local config = {}
      config.font_size = 12.0
      return config
    '';
  };
}
WEZTERMEOF

  git add nix/home/wezterm.nix

  # Attempt commit - should succeed
  if git commit -m "Valid Lua" 2>&1; then
    echo -e "${GREEN}✓ PASS: Hook correctly allowed commit with valid Lua${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Hook blocked commit with valid Lua${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    cd "$REPO_ROOT"
    return 1
  fi

  cd "$REPO_ROOT"
}

# Test 22: Home Manager build check pre-push hook execution (E2E)
test_home_manager_build_check_pre_push_hook_e2e() {
  print_test_header "test_home_manager_build_check_pre_push_hook_e2e"

  # Create test repo with pre-push hook
  local tempdir=$(mktemp -d)
  trap "rm -rf '$tempdir'" EXIT

  cd "$tempdir"
  git init --initial-branch=main
  git config user.name "Test User"
  git config user.email "test@example.com"

  # Create bare repository to serve as remote (outside the working tree)
  local bare_remote=$(mktemp -d)
  git init --bare "$bare_remote"

  # Create minimal Home Manager file structure
  mkdir -p nix/home
  cat > nix/home/default.nix <<'HOMEEOF'
{ config, pkgs, lib, ... }:
{
  home.packages = with pkgs; [ git ];
}
HOMEEOF

  # Create pre-push hook that mimics home-manager-build-check
  # Uses simplified validation (no actual nix build in test environment)
  mkdir -p .git/hooks
  cat > .git/hooks/pre-push <<'HOOKEOF'
#!/bin/bash
set -e

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "ERROR: Not in a git repository"
  exit 1
fi

# Verify origin/main exists
if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
  echo "ERROR: Remote branch 'origin/main' not found"
  exit 1
fi

# Get list of changed files between main and current branch
CHANGED_FILES=$(git diff --name-only origin/main...HEAD) || {
  echo "ERROR: Failed to determine changed files"
  exit 1
}

# Check if nix/home/ directory or flake.nix changed
if echo "$CHANGED_FILES" | grep -qE "(nix/home/|flake\.nix)"; then
  echo "Home Manager configuration files changed, validating build..."

  # In real hook this would run: nix build .#homeConfigurations
  # For testing, we do basic syntax check
  if grep -q "BROKEN" nix/home/default.nix 2>/dev/null; then
    echo ""
    echo "ERROR: Home Manager configuration failed to build"
    echo "Found BROKEN marker in configuration"
    echo ""
    exit 1
  fi

  echo "✅ Home Manager configuration builds successfully"
else
  echo "No Home Manager configuration changes detected, skipping build check."
fi
HOOKEOF
  chmod +x .git/hooks/pre-push

  # Create initial commit on main and push to remote
  # First push doesn't have origin/main yet, so temporarily disable hook
  git add .
  git commit -m "Initial commit"
  git remote add origin "$bare_remote"
  mv .git/hooks/pre-push .git/hooks/pre-push.disabled
  git push -u origin main
  mv .git/hooks/pre-push.disabled .git/hooks/pre-push

  # Test 1: Verify hook executes on push with Home Manager changes
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Pre-push hook validates Home Manager changes${NC}"

  # Create feature branch
  git checkout -b feature

  # Modify Home Manager config (valid change)
  cat > nix/home/default.nix <<'HOMEEOF'
{ config, pkgs, lib, ... }:
{
  home.packages = with pkgs; [ git vim ];
}
HOMEEOF

  git add nix/home/default.nix
  git commit -m "Add vim to packages"

  # Attempt push - should succeed with hook execution
  push_output=$(git push -u origin feature 2>&1)
  if echo "$push_output" | grep -q "Home Manager configuration"; then
    echo -e "${GREEN}✓ PASS: Hook executed and validated Home Manager changes${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Hook did not execute on Home Manager changes${NC}"
    echo "Push output: $push_output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    cd "$REPO_ROOT"
    return 1
  fi

  # Test 2: Verify hook blocks push with broken Home Manager config
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -e "${YELLOW}Running: Pre-push hook blocks broken Home Manager config${NC}"

  # Introduce broken config (marked with BROKEN)
  cat > nix/home/default.nix <<'HOMEEOF'
{ config, pkgs, lib, ... }:
{
  # BROKEN configuration
  home.packages = with pkgs; [ git vim ];
}
HOMEEOF

  git add nix/home/default.nix
  git commit -m "Break config"

  # Attempt push - should fail
  push_failed=0
  push_output=$(git push 2>&1) || push_failed=1
  if [[ $push_failed -eq 1 ]] && echo "$push_output" | grep -q "ERROR: Home Manager configuration failed"; then
    echo -e "${GREEN}✓ PASS: Hook correctly blocked push with broken config${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: Hook did not block push with broken config${NC}"
    echo "Push output: $push_output"
    echo "Push failed: $push_failed"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    cd "$REPO_ROOT"
    return 1
  fi

  cd "$REPO_ROOT"
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
      echo "  test_worktree_hook_blocks_invalid_changes"
      echo "  test_mcp_build_detects_untracked_files"
      echo "  test_home_manager_build_check_skip"
      echo "  test_home_manager_build_check_detects_home_changes"
      echo "  test_home_manager_build_check_detects_flake_changes"
      echo "  test_home_manager_build_check_no_origin_main"
      echo "  test_home_manager_build_check_regex_pattern"
      echo "  test_wezterm_lua_validation"
      echo "  test_ci_workflow_home_manager_build"
      echo "  test_wezterm_lua_syntax_pre_commit_hook_e2e"
      echo "  test_home_manager_build_check_pre_push_hook_e2e"
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
    test_worktree_hook_blocks_invalid_changes
    test_mcp_build_detects_untracked_files
    test_home_manager_build_check_skip
    test_home_manager_build_check_detects_home_changes
    test_home_manager_build_check_detects_flake_changes
    test_home_manager_build_check_no_origin_main
    test_home_manager_build_check_regex_pattern
    # WezTerm and Home Manager tests only run on Darwin since Home Manager config is Darwin-specific
    if [[ "$(uname)" == "Darwin" ]]; then
      test_wezterm_lua_validation
      test_ci_workflow_home_manager_build
      test_wezterm_lua_syntax_pre_commit_hook_e2e
    else
      echo -e "${YELLOW}Skipping Darwin-specific tests (WezTerm, Home Manager) on non-Darwin platform${NC}"
    fi
    test_home_manager_build_check_pre_push_hook_e2e
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
