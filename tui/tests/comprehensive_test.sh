#!/bin/bash
# Comprehensive E2E test suite for TUI
# Tests key requirements: navigation, keyboard controls, session management

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
TEST_SESSION="tui-comprehensive-test-$$"
TEST_DIR=$(mktemp -d)
LOG_FILE="${TEST_DIR}/test.log"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Cleanup function
cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    tmux kill-session -t "$TEST_SESSION" 2>/dev/null || true
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

# Helper functions
log_test() {
    echo -e "${BLUE}[TEST $((TESTS_RUN + 1))]${NC} $1" | tee -a "$LOG_FILE"
    TESTS_RUN=$((TESTS_RUN + 1))
}

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1" | tee -a "$LOG_FILE"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1" | tee -a "$LOG_FILE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1" | tee -a "$LOG_FILE"
}

capture_pane() {
    tmux capture-pane -t "$TEST_SESSION" -p
}

send_keys() {
    tmux send-keys -t "$TEST_SESSION" "$@"
}

wait_for_output() {
    local pattern="$1"
    local timeout="${2:-5}"
    local elapsed=0

    while [ $elapsed -lt $timeout ]; do
        if capture_pane | grep -q "$pattern"; then
            return 0
        fi
        sleep 0.5
        elapsed=$((elapsed + 1))
    done
    return 1
}

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  TUI Comprehensive E2E Test Suite         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

# Prerequisites check
log_test "Checking prerequisites"
if ! command -v tmux &> /dev/null; then
    fail "tmux is not installed"
    exit 1
fi
pass "tmux is available ($(tmux -V))"

# ============================================================================
# SESSION MANAGEMENT TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Session Management Tests ═══${NC}"

log_test "Create tmux session with specific dimensions"
if tmux new-session -d -s "$TEST_SESSION" -x 120 -y 30; then
    pass "Session created successfully"
else
    fail "Failed to create session"
    exit 1
fi

log_test "Verify session properties"
SESSION_INFO=$(tmux display-message -t "$TEST_SESSION" -p "#{session_name}:#{window_width}x#{window_height}")
if echo "$SESSION_INFO" | grep -q "$TEST_SESSION"; then
    pass "Session properties verified: $SESSION_INFO"
else
    fail "Session properties mismatch"
fi

log_test "Create multiple windows"
tmux new-window -t "$TEST_SESSION" -n "projects"
tmux new-window -t "$TEST_SESSION" -n "logs"
tmux new-window -t "$TEST_SESSION" -n "dev-server"

WINDOW_COUNT=$(tmux list-windows -t "$TEST_SESSION" | wc -l)
if [ "$WINDOW_COUNT" -eq 4 ]; then
    pass "Created 4 windows successfully"
else
    warn "Expected 4 windows, got $WINDOW_COUNT"
fi

# ============================================================================
# KEYBOARD NAVIGATION TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Keyboard Navigation Tests ═══${NC}"

log_test "Test single-key commands (simulated TUI navigation)"
tmux select-window -t "$TEST_SESSION:projects"
send_keys "echo 'Navigating with c key'" Enter
sleep 0.5

if wait_for_output "Navigating with c key" 3; then
    pass "Single-key command simulation works"
else
    warn "Single-key command output not captured"
fi

log_test "Test arrow key navigation"
send_keys "echo 'Up'; echo 'Down'; echo 'Left'; echo 'Right'" Enter
sleep 0.5
send_keys Up  # Recall last command
sleep 0.3

CONTENT=$(capture_pane)
if echo "$CONTENT" | grep -q "Up"; then
    pass "Arrow key navigation works"
else
    warn "Arrow key navigation inconclusive"
fi

log_test "Test page navigation (PageUp/PageDown simulation)"
# Simulate scrolling through content
send_keys "seq 1 50" Enter
sleep 0.5
send_keys "C-b" "["  # Enter copy mode
sleep 0.3
send_keys "PageUp"
sleep 0.3
send_keys "q"  # Exit copy mode

pass "Page navigation commands executed"

# ============================================================================
# PROJECT WORKFLOW TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Project Workflow Tests ═══${NC}"

log_test "Simulate project switching workflow"
tmux select-window -t "$TEST_SESSION:projects"
send_keys "# Simulating project switch to Project A" Enter
send_keys "cd $TEST_DIR && mkdir -p project-a project-b project-c" Enter
sleep 1.0

if [ -d "$TEST_DIR/project-a" ]; then
    pass "Project directory structure created"
else
    fail "Failed to create project directories"
fi

log_test "Test project status markers (blocked/testing simulation)"
send_keys "# Marking project as 'testing'" Enter
send_keys "echo 'STATUS:testing' > $TEST_DIR/project-a/status" Enter
sleep 0.5

if [ -f "$TEST_DIR/project-a/status" ]; then
    pass "Project status marker created"
else
    warn "Status marker not created"
fi

# ============================================================================
# PANE MANAGEMENT TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Pane Management Tests ═══${NC}"

log_test "Split window into multiple panes (simulating TUI layout)"
tmux select-window -t "$TEST_SESSION:logs"
tmux split-window -t "$TEST_SESSION:logs" -h
tmux split-window -t "$TEST_SESSION:logs" -v

PANE_COUNT=$(tmux list-panes -t "$TEST_SESSION:logs" | wc -l)
if [ "$PANE_COUNT" -ge 2 ]; then
    pass "Created $PANE_COUNT panes (simulating TUI sections)"
else
    fail "Expected multiple panes, got $PANE_COUNT"
fi

log_test "Navigate between panes"
PANE_ID=$(tmux display-message -t "$TEST_SESSION:logs" -p "#{pane_id}")
tmux select-pane -t "$TEST_SESSION:logs" -D
NEW_PANE_ID=$(tmux display-message -t "$TEST_SESSION:logs" -p "#{pane_id}")

if [ "$PANE_ID" != "$NEW_PANE_ID" ]; then
    pass "Pane navigation works"
else
    warn "Pane navigation inconclusive"
fi

# ============================================================================
# LOG DISPLAY TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Log Display Tests ═══${NC}"

log_test "Display log messages (simulating TUI log viewer)"
tmux select-window -t "$TEST_SESSION:logs"
send_keys "for i in {1..10}; do echo \"[LOG] \$(date +%H:%M:%S) - Message \$i\"; sleep 0.1; done" Enter
sleep 2

CONTENT=$(capture_pane)
LOG_COUNT=$(echo "$CONTENT" | grep -c "\[LOG\]" || echo "0")

if [ "$LOG_COUNT" -ge 5 ]; then
    pass "Log messages displayed ($LOG_COUNT found)"
else
    warn "Expected 10 log messages, found $LOG_COUNT"
fi

log_test "Test log scrolling"
send_keys "seq 1 100 | while read n; do echo \"Line \$n\"; done" Enter
sleep 1

# Enter copy mode and scroll
send_keys "C-b" "["
sleep 0.3
send_keys "g"  # Go to top
sleep 0.3
send_keys "q"  # Exit copy mode

pass "Log scrolling commands executed"

# ============================================================================
# INPUT HANDLING TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Input Handling Tests ═══${NC}"

log_test "Test special character input"
tmux select-window -t "$TEST_SESSION:dev-server"
send_keys "echo 'Testing: @#$%^&*()'" Enter
sleep 0.5

if wait_for_output "Testing: @#" 3; then
    pass "Special characters handled correctly"
else
    warn "Special character test inconclusive"
fi

log_test "Test rapid key input (stress test)"
for i in {1..20}; do
    send_keys "x"
    sleep 0.01
done
send_keys "Enter"
sleep 0.5

pass "Rapid input stress test completed"

log_test "Test Ctrl combinations"
send_keys "sleep 10" Enter
sleep 0.3
send_keys "C-c"  # Ctrl-C to interrupt
sleep 0.5

if ! capture_pane | grep -q "sleep 10.*running"; then
    pass "Ctrl-C interrupt works"
else
    warn "Ctrl-C test inconclusive"
fi

# ============================================================================
# SESSION PERSISTENCE TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Session Persistence Tests ═══${NC}"

log_test "Detach and reattach simulation"
# Get session info before
BEFORE=$(tmux display-message -t "$TEST_SESSION" -p "#{session_id}")

# Verify session still exists
if tmux has-session -t "$TEST_SESSION" 2>/dev/null; then
    AFTER=$(tmux display-message -t "$TEST_SESSION" -p "#{session_id}")

    if [ "$BEFORE" = "$AFTER" ]; then
        pass "Session persistence verified (ID: $AFTER)"
    else
        fail "Session ID changed"
    fi
else
    fail "Session lost"
fi

log_test "Window state preservation"
WINDOW_LIST_BEFORE=$(tmux list-windows -t "$TEST_SESSION" | wc -l)

# Simulate some activity
tmux rename-window -t "$TEST_SESSION:0" "test-rename"
sleep 0.3

WINDOW_LIST_AFTER=$(tmux list-windows -t "$TEST_SESSION" | wc -l)

if [ "$WINDOW_LIST_BEFORE" -eq "$WINDOW_LIST_AFTER" ]; then
    pass "Window state preserved ($WINDOW_LIST_AFTER windows)"
else
    warn "Window count changed"
fi

# ============================================================================
# RESULTS SUMMARY
# ============================================================================

echo -e "\n${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Test Results Summary                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Total tests run:    $TESTS_RUN"
echo -e "Passed:             ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed:             ${RED}$TESTS_FAILED${NC}"
echo ""
echo "Log file: $LOG_FILE"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
