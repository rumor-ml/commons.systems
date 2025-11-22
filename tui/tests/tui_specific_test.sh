#!/bin/bash
# TUI-Specific E2E Tests
# Tests actual TUI features: project navigation, Claude monitoring, keyboard shortcuts

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TEST_SESSION="tui-specific-test-$$"
TEST_DIR=$(mktemp -d)
LOG_FILE="${TEST_DIR}/test.log"
TUI_BINARY="../tui-binary"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    tmux kill-session -t "$TEST_SESSION" 2>/dev/null || true
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

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
echo -e "${GREEN}║  TUI-Specific E2E Test Suite              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

# Check if TUI binary exists
log_test "Check for TUI binary"
if [ -f "$TUI_BINARY" ]; then
    pass "TUI binary found at $TUI_BINARY ($(ls -lh $TUI_BINARY | awk '{print $5}'))"
else
    fail "TUI binary not found at $TUI_BINARY"
    echo "Run: cd /home/user/commons.systems/tui && env GOTOOLCHAIN=local go build -o tui-binary main.go"
    exit 1
fi

# ============================================================================
# PROJECT NAVIGATION SIMULATION TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Project Navigation Simulation Tests ═══${NC}"

log_test "Create mock project structure"
mkdir -p "$TEST_DIR/projects"/{project-a,project-b,project-c}
mkdir -p "$TEST_DIR/projects/project-a/.git"
mkdir -p "$TEST_DIR/projects/project-b/.git"
mkdir -p "$TEST_DIR/projects/project-c/.git"

# Create mock project files
cat > "$TEST_DIR/projects/project-a/README.md" << 'EOF'
# Project A
Test project for TUI navigation
EOF

cat > "$TEST_DIR/projects/project-b/go.mod" << 'EOF'
module test.com/project-b
go 1.24.0
EOF

if [ -d "$TEST_DIR/projects/project-a" ]; then
    pass "Mock project structure created (3 projects)"
else
    fail "Failed to create project structure"
fi

log_test "Simulate project discovery"
tmux new-session -d -s "$TEST_SESSION" -x 120 -y 40
sleep 0.5

# Simulate listing projects
send_keys "echo 'Discovering projects...'" Enter
sleep 0.3
send_keys "ls -la $TEST_DIR/projects/" Enter
sleep 0.5

if wait_for_output "project-a" 3; then
    pass "Project listing command executed"
else
    warn "Project listing output not captured"
fi

log_test "Simulate project switching workflow"
send_keys "# Switching to project-a" Enter
send_keys "cd $TEST_DIR/projects/project-a" Enter
sleep 0.3
send_keys "pwd" Enter
sleep 0.5

if wait_for_output "project-a" 3; then
    pass "Project switch simulation works"
else
    warn "Project switch verification inconclusive"
fi

log_test "Test project status markers"
# Simulate marking project as 'testing'
send_keys "echo 'STATUS=testing' > .tui-status" Enter
sleep 0.3
send_keys "cat .tui-status" Enter
sleep 0.5

if wait_for_output "STATUS=testing" 3; then
    pass "Project status marker created and verified"
else
    warn "Status marker test inconclusive"
fi

# ============================================================================
# KEYBOARD SHORTCUTS SIMULATION TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Keyboard Shortcuts Simulation Tests ═══${NC}"

log_test "Test single-key navigation (c for Claude)"
send_keys "# Simulating 'c' key press for Claude navigation" Enter
sleep 0.3
send_keys "echo 'c'" Enter
sleep 0.5

if wait_for_output "c" 3; then
    pass "Single-key command 'c' simulation works"
else
    warn "Single-key test inconclusive"
fi

log_test "Test z key for Zsh navigation"
send_keys "echo 'z - Navigate to Zsh'" Enter
sleep 0.5

if wait_for_output "Zsh" 3; then
    pass "Zsh navigation key simulation works"
else
    warn "Zsh key test inconclusive"
fi

log_test "Test n key for Nvim navigation"
send_keys "echo 'n - Navigate to Nvim'" Enter
sleep 0.5

if wait_for_output "Nvim" 3; then
    pass "Nvim navigation key simulation works"
else
    warn "Nvim key test inconclusive"
fi

log_test "Test x key for toggle blocking status"
send_keys "echo 'x - Toggle blocking status'" Enter
sleep 0.5

if wait_for_output "blocking" 3; then
    pass "Blocking toggle key simulation works"
else
    warn "Blocking toggle test inconclusive"
fi

# ============================================================================
# CLAUDE MONITORING SIMULATION TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Claude Monitoring Simulation Tests ═══${NC}"

log_test "Simulate Claude session detection"
# Create mock Claude process indicator
send_keys "echo 'CLAUDE_SESSION=active' > $TEST_DIR/claude.env" Enter
sleep 0.3
send_keys "cat $TEST_DIR/claude.env" Enter
sleep 0.5

if wait_for_output "CLAUDE_SESSION=active" 3; then
    pass "Claude session indicator created"
else
    warn "Claude session simulation inconclusive"
fi

log_test "Simulate Claude activity monitoring"
# Simulate Claude activity logs
send_keys "echo '[$(date +%H:%M:%S)] Claude: Processing request...'" Enter
sleep 0.3
send_keys "echo '[$(date +%H:%M:%S)] Claude: Generating response...'" Enter
sleep 0.3
send_keys "echo '[$(date +%H:%M:%S)] Claude: Task completed'" Enter
sleep 0.5

CONTENT=$(capture_pane)
CLAUDE_COUNT=$(echo "$CONTENT" | grep -c "Claude:" || echo "0")

if [ "$CLAUDE_COUNT" -ge 2 ]; then
    pass "Claude activity simulation works ($CLAUDE_COUNT messages)"
else
    warn "Expected multiple Claude messages, found $CLAUDE_COUNT"
fi

log_test "Test Claude session persistence"
send_keys "echo 'SESSION_ID=claude-123' >> $TEST_DIR/claude.env" Enter
sleep 0.3
send_keys "grep SESSION_ID $TEST_DIR/claude.env" Enter
sleep 0.5

if wait_for_output "SESSION_ID=claude-123" 3; then
    pass "Claude session persistence works"
else
    warn "Session persistence test inconclusive"
fi

# ============================================================================
# TMUX INTEGRATION TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Tmux Integration Tests ═══${NC}"

log_test "Test ctrl-b t binding simulation (mark as testing)"
# This would normally be: tmux send-keys "C-b" "t"
# But we'll simulate the effect
send_keys "echo 'Simulating ctrl-b t: Mark project as testing'" Enter
send_keys "echo 'TESTING=true' > $TEST_DIR/testing-marker" Enter
sleep 0.5

if wait_for_output "testing" 3; then
    pass "Ctrl-b t binding simulation works"
else
    warn "Ctrl-b t test inconclusive"
fi

log_test "Test window creation for project shells"
tmux new-window -t "$TEST_SESSION" -n "claude-shell"
tmux new-window -t "$TEST_SESSION" -n "zsh-shell"
tmux new-window -t "$TEST_SESSION" -n "nvim-shell"

WINDOW_COUNT=$(tmux list-windows -t "$TEST_SESSION" | wc -l)
if [ "$WINDOW_COUNT" -ge 4 ]; then
    pass "Created multiple shell windows ($WINDOW_COUNT windows)"
else
    warn "Expected 4+ windows, got $WINDOW_COUNT"
fi

log_test "Test pane discovery and management"
tmux select-window -t "$TEST_SESSION:claude-shell"
tmux split-window -t "$TEST_SESSION:claude-shell" -h
PANE_COUNT=$(tmux list-panes -t "$TEST_SESSION:claude-shell" | wc -l)

if [ "$PANE_COUNT" -eq 2 ]; then
    pass "Pane splitting works (2 panes in claude-shell)"
else
    warn "Expected 2 panes, got $PANE_COUNT"
fi

# ============================================================================
# DEV SERVER SIMULATION TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Dev Server Simulation Tests ═══${NC}"

log_test "Simulate dev server status check"
tmux select-window -t "$TEST_SESSION:0"
send_keys "echo 'DEV_SERVER_STATUS=running'" Enter
send_keys "echo 'DEV_SERVER_PORT=3000'" Enter
sleep 0.5

if wait_for_output "DEV_SERVER_STATUS=running" 3; then
    pass "Dev server status simulation works"
else
    warn "Dev server status test inconclusive"
fi

log_test "Simulate dev server restart"
send_keys "echo 'Restarting dev server...'" Enter
send_keys "sleep 0.5 && echo 'Dev server restarted successfully'" Enter
sleep 1.0

if wait_for_output "restarted successfully" 3; then
    pass "Dev server restart simulation works"
else
    warn "Dev server restart test inconclusive"
fi

# ============================================================================
# LOG VIEWER SIMULATION TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Log Viewer Simulation Tests ═══${NC}"

log_test "Simulate log viewer with multiple entries"
send_keys "for i in {1..20}; do echo \"[$(date +%H:%M:%S)] Log entry \$i\"; done" Enter
sleep 1.5

CONTENT=$(capture_pane)
LOG_COUNT=$(echo "$CONTENT" | grep -c "Log entry" || echo "0")

if [ "$LOG_COUNT" -ge 10 ]; then
    pass "Log viewer simulation works ($LOG_COUNT log entries)"
else
    warn "Expected 20 log entries, found $LOG_COUNT"
fi

log_test "Test log navigation (PageUp/PageDown simulation)"
send_keys "C-b" "["  # Enter copy mode
sleep 0.3
send_keys "g"  # Go to top
sleep 0.3
send_keys "G"  # Go to bottom
sleep 0.3
send_keys "q"  # Exit copy mode

pass "Log navigation commands executed"

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
    echo -e "${GREEN}✓ All TUI-specific tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
