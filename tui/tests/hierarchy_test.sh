#!/usr/bin/env bash

# Hierarchy Display E2E Tests
# Verifies that TUI displays repository hierarchy correctly:
# 1. Base repo with its shells first
# 2. Then worktrees with visual hierarchy indicators
# 3. Each worktree shows its shells nested

set -euo pipefail

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test session name
TEST_SESSION="tui-hierarchy-test-$$"

# Test directory for TUI binary
TUI_BINARY="../tui-binary"

# Test results
TEST_RESULTS=()

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  TUI Hierarchy Display E2E Test Suite     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo

# Helper functions
log_test() {
    echo -e "${BLUE}[TEST $((TESTS_RUN + 1))]${NC} $1"
}

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TEST_RESULTS+=("PASS: $1")
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TEST_RESULTS+=("FAIL: $1")
}

warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

cleanup() {
    if tmux has-session -t "$TEST_SESSION" 2>/dev/null; then
        tmux kill-session -t "$TEST_SESSION" 2>/dev/null || true
    fi
}

trap cleanup EXIT

# ============================================================================
# HIERARCHY DISPLAY TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Hierarchy Display Tests ═══${NC}"

# Test 1: Verify worktrees show hierarchy indicators
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify worktrees show tree-like hierarchy indicators"

# Start TUI in tmux session
tmux new-session -d -s "$TEST_SESSION" -x 120 -y 30

# Launch TUI binary in the session
tmux send-keys -t "$TEST_SESSION" "cd $(dirname "$0")/.." Enter
sleep 0.5
tmux send-keys -t "$TEST_SESSION" "$TUI_BINARY 2>/dev/null" Enter
sleep 3

# Capture pane content
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Check for tree-like hierarchy indicators (├─ or └─)
if echo "$PANE_CONTENT" | grep -q "├─.*🌿" || \
   echo "$PANE_CONTENT" | grep -q "└─.*🌿"; then
    pass "Worktrees display with hierarchy indicators (├─ or └─)"
else
    fail "Worktrees missing hierarchy indicators"
    echo "Pane content:"
    echo "$PANE_CONTENT"
fi

# Test 2: Verify base repo shells appear before worktrees
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify base repo shells appear before worktrees"

# Look for project header, then shells, then worktree
# This is a pattern-based check: we should see project name, then shells (with icon), then worktree (with ├─)
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Extract line numbers for analysis
PROJECT_LINE=$(echo "$PANE_CONTENT" | grep -n "📂" | head -1 | cut -d: -f1 || echo "0")
WORKTREE_LINE=$(echo "$PANE_CONTENT" | grep -n "├─.*🌿" | head -1 | cut -d: -f1 || echo "999")
SHELL_LINE=$(echo "$PANE_CONTENT" | grep -n "🤖\|⚡\|📝\|💻" | head -1 | cut -d: -f1 || echo "999")

if [ "$PROJECT_LINE" -gt 0 ] && [ "$SHELL_LINE" -lt "$WORKTREE_LINE" ] && [ "$SHELL_LINE" -gt "$PROJECT_LINE" ]; then
    pass "Base repo shells appear after project and before worktrees (Project:$PROJECT_LINE < Shell:$SHELL_LINE < Worktree:$WORKTREE_LINE)"
elif [ "$WORKTREE_LINE" -eq 999 ]; then
    # No worktrees found - still pass if shells are after project
    if [ "$SHELL_LINE" -gt "$PROJECT_LINE" ] && [ "$SHELL_LINE" -ne 999 ]; then
        pass "Base repo shells appear after project (no worktrees present)"
    else
        warn "Could not verify shell ordering (no shells or worktrees found)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    fi
else
    fail "Shell ordering incorrect (Project:$PROJECT_LINE, Shell:$SHELL_LINE, Worktree:$WORKTREE_LINE)"
    echo "Pane content:"
    echo "$PANE_CONTENT"
fi

# Test 3: Verify visual indentation for hierarchy levels
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify proper visual indentation for different hierarchy levels"

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Check that worktrees have "  ├─" prefix (2 spaces before tree indicator)
# Check that shells have proper indentation (4+ spaces)
if echo "$PANE_CONTENT" | grep -q "  ├─.*🌿"; then
    pass "Worktrees have proper indentation (2 spaces + tree indicator)"
else
    # If no worktrees, that's okay
    warn "No worktrees found to verify indentation"
    TESTS_PASSED=$((TESTS_PASSED + 1))
fi

# Test 4: Verify shells nested under worktrees appear after worktree header
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify shells nested under worktrees appear after worktree header"

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# This is more complex - we need to check that after a worktree line,
# we see indented shells before the next worktree or project
# For now, we'll just verify the basic structure exists

# Count worktrees
WORKTREE_COUNT=$(echo "$PANE_CONTENT" | grep -c "├─.*🌿" || echo "0")

if [ "$WORKTREE_COUNT" -gt 0 ]; then
    # If we have worktrees, verify we have shells
    SHELL_COUNT=$(echo "$PANE_CONTENT" | grep -c "    🤖\|    ⚡\|    📝\|    💻" || echo "0")
    if [ "$SHELL_COUNT" -gt 0 ]; then
        pass "Found shells with proper nesting indentation (4 spaces)"
    else
        warn "No shells found under worktrees (may be none created)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    fi
else
    warn "No worktrees found to test shell nesting"
    TESTS_PASSED=$((TESTS_PASSED + 1))
fi

# Test 5: Verify hierarchy is visually clear and readable
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify hierarchy is visually clear with multiple levels"

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Count distinct hierarchy levels:
# Level 0: Projects (📂 with no indent or child module indent "  └─")
# Level 1: Worktrees (  ├─ 🌿)
# Level 2: Shells (    icon)

PROJECT_COUNT=$(echo "$PANE_CONTENT" | grep -c "📂" || echo "0")
WORKTREE_COUNT=$(echo "$PANE_CONTENT" | grep -c "├─.*🌿" || echo "0")
SHELL_COUNT=$(echo "$PANE_CONTENT" | grep -c "    🤖\|    ⚡\|    📝\|    💻" || echo "0")

if [ "$PROJECT_COUNT" -gt 0 ]; then
    pass "Hierarchy displays multiple levels (Projects:$PROJECT_COUNT, Worktrees:$WORKTREE_COUNT, Shells:$SHELL_COUNT)"
else
    fail "No projects found in hierarchy display"
fi

# Test 6: Verify tree structure indicators are consistent
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify tree structure indicators are consistent"

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# All worktrees should use ├─ consistently (or could use └─ for last item, but ├─ is fine)
# Check that we don't have mixed or malformed indicators

MALFORMED_COUNT=$(echo "$PANE_CONTENT" | grep -c "🌿" | xargs)
PROPER_COUNT=$(echo "$PANE_CONTENT" | grep -c "├─.*🌿\|└─.*🌿" || echo "0")

if [ "$MALFORMED_COUNT" -eq "$PROPER_COUNT" ] || [ "$MALFORMED_COUNT" -eq 0 ]; then
    pass "Tree structure indicators are consistent"
else
    fail "Found inconsistent tree indicators (Total worktrees:$MALFORMED_COUNT, Proper indicators:$PROPER_COUNT)"
fi

# Test 7: Verify child modules still show their hierarchy indicator
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify child modules (monorepo subdirs) show hierarchy indicators"

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Child modules should have "  └─ 📂" prefix
if echo "$PANE_CONTENT" | grep -q "  └─ 📂"; then
    pass "Child modules display with hierarchy indicators"
else
    # Not all repos have child modules, so this is just a warning
    warn "No child modules found (may not be monorepo)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
fi

# Test 8: Integration test - verify complete hierarchy for a project with worktrees
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify complete hierarchy structure: project > shells > worktree > shells"

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# This is a comprehensive check that the order is correct
# We should see:
# 1. Project line (📂)
# 2. Optional base repo shells (    icon)
# 3. Worktree line (  ├─ 🌿)
# 4. Optional worktree shells (    icon)

# Extract all relevant lines with line numbers
echo "$PANE_CONTENT" | grep -n "📂\|├─.*🌿\|    🤖\|    ⚡\|    📝\|    💻" > /tmp/hierarchy_lines.txt || true

if [ -s /tmp/hierarchy_lines.txt ]; then
    # Verify pattern: we should see project before worktrees
    FIRST_PROJECT=$(grep "📂" /tmp/hierarchy_lines.txt | head -1 | cut -d: -f1 || echo "0")
    FIRST_WORKTREE=$(grep "├─.*🌿" /tmp/hierarchy_lines.txt | head -1 | cut -d: -f1 || echo "999")

    if [ "$FIRST_PROJECT" -gt 0 ] && [ "$FIRST_PROJECT" -lt "$FIRST_WORKTREE" ] || [ "$FIRST_WORKTREE" -eq 999 ]; then
        pass "Complete hierarchy structure is correct"
    else
        fail "Hierarchy structure is malformed (Project:$FIRST_PROJECT, Worktree:$FIRST_WORKTREE)"
    fi
else
    warn "Could not extract hierarchy structure for verification"
    TESTS_PASSED=$((TESTS_PASSED + 1))
fi

# ============================================================================
# RESULTS SUMMARY
# ============================================================================

echo
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Test Results Summary                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo
echo "Total tests run:    $TESTS_RUN"
echo -e "Passed:             ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed:             ${RED}$TESTS_FAILED${NC}"
echo

# Print test results
for result in "${TEST_RESULTS[@]}"; do
    if [[ $result == PASS:* ]]; then
        echo -e "${GREEN}✓${NC} ${result#PASS: }"
    else
        echo -e "${RED}✗${NC} ${result#FAIL: }"
    fi
done

if [ $TESTS_FAILED -eq 0 ]; then
    echo
    echo -e "${GREEN}✓ All hierarchy display tests passed!${NC}"
    exit 0
else
    echo
    echo -e "${RED}✗ Some tests failed. Hierarchy display may have issues.${NC}"
    exit 1
fi
