#!/usr/bin/env bash
# Integration tests for direnv-loader.sh
# Resolves TODO(#1739): Add integration tests for MCP direnv wrapper

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ANSI color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test framework
TESTS_RUN=0
TESTS_PASSED=0

test_case() {
  echo -e "${YELLOW}TEST:${NC} $1"
  TESTS_RUN=$((TESTS_RUN + 1))
}

assert_success() {
  if [ $? -eq 0 ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "  ${GREEN}✓ PASS${NC}"
  else
    echo -e "  ${RED}✗ FAIL${NC}"
  fi
}

assert_failure() {
  if [ $? -ne 0 ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "  ${GREEN}✓ PASS${NC} (correctly failed)"
  else
    echo -e "  ${RED}✗ FAIL${NC} (should have failed)"
  fi
}

echo "========================================================"
echo "direnv-loader.sh Integration Tests"
echo "========================================================"
echo ""

# Test 1: Load from repo root
cd "$REPO_ROOT"
test_case "Load direnv from repository root"
source infrastructure/scripts/lib/direnv-loader.sh
load_direnv_environment "direnv" "false" >/dev/null 2>&1
assert_success

# Test 2: Verify Node.js from Nix
test_case "Node.js is from Nix store (not Homebrew)"
NODE_PATH=$(which node)
if [[ "$NODE_PATH" == *"/nix/store/"* ]]; then
  echo -e "  ${GREEN}✓ PASS${NC} (Node.js: $NODE_PATH)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗ FAIL${NC} (Node.js not from Nix: $NODE_PATH)"
fi

# Test 3: Verify pnpm available
test_case "pnpm is available in environment"
command -v pnpm >/dev/null 2>&1
assert_success

# Test 4: Fail without .envrc
test_case "Fail gracefully when .envrc missing"
# Save current .envrc temporarily
SAVED_ENVRC="$REPO_ROOT/.envrc.backup.$$"
mv "$REPO_ROOT/.envrc" "$SAVED_ENVRC"
# Test that function fails without .envrc (capture exit code without triggering set -e)
cd "$REPO_ROOT"
TEST_RESULT=0
load_direnv_environment "direnv" "false" >/dev/null 2>&1 && TEST_RESULT=$? || TEST_RESULT=$?
# Restore .envrc
mv "$SAVED_ENVRC" "$REPO_ROOT/.envrc"
# Check that it failed (returned non-zero)
[ "$TEST_RESULT" -ne 0 ]
assert_success

# Test 5: Auto-recovery after cache clear
test_case "Auto-recovery works after cache clear"
cd "$REPO_ROOT"
# Save current state
CACHE_EXISTED=false
if [ -d .direnv ]; then
  CACHE_EXISTED=true
fi

# Clear cache
rm -rf .direnv 2>/dev/null || true

# Try to load (should auto-recover)
load_direnv_environment "direnv" "false" >/dev/null 2>&1
assert_success

# Test 6: Verbose mode shows diagnostic output
test_case "Verbose mode shows diagnostic output"
cd "$REPO_ROOT"
OUTPUT=$(load_direnv_environment "direnv" "true" 2>&1)
if echo "$OUTPUT" | grep -q "Loading direnv environment"; then
  echo -e "  ${GREEN}✓ PASS${NC} (verbose output detected)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗ FAIL${NC} (no verbose output)"
fi

# Test 7: Function can be called multiple times
test_case "Function can be called multiple times without error"
cd "$REPO_ROOT"
load_direnv_environment "direnv" "false" >/dev/null 2>&1 && \
load_direnv_environment "direnv" "false" >/dev/null 2>&1
assert_success

# Summary
echo ""
echo "========================================================"
echo "Test Summary"
echo "========================================================"
echo "Tests run:    $TESTS_RUN"
echo "Tests passed: $TESTS_PASSED"
echo ""

if [ $TESTS_PASSED -eq $TESTS_RUN ]; then
  echo -e "${GREEN}✓ All tests passed${NC}"
  exit 0
else
  FAILED=$((TESTS_RUN - TESTS_PASSED))
  echo -e "${RED}✗ $FAILED test(s) failed${NC}"
  exit 1
fi
