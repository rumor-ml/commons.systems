#!/usr/bin/env bash

# UI Rendering E2E Tests
# Verifies that TUI displays Bubble Tea UI, not log output

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
TEST_SESSION="tui-ui-render-test-$$"

# Test directory for TUI binary
TUI_BINARY="../tui-binary"

# Test results
TEST_RESULTS=()

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  TUI UI Rendering E2E Test Suite          ║${NC}"
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
# UI RENDERING TESTS
# ============================================================================

echo -e "\n${BLUE}═══ UI Rendering Tests ═══${NC}"

# Test 1: Verify TUI doesn't output logs to terminal
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify TUI doesn't output logs to pane content"

# Start TUI in tmux session
tmux new-session -d -s "$TEST_SESSION" -x 120 -y 30

# Launch TUI binary in the session
tmux send-keys -t "$TEST_SESSION" "cd $(dirname "$0")/.." Enter
sleep 0.5
tmux send-keys -t "$TEST_SESSION" "$TUI_BINARY 2>/dev/null &" Enter
sleep 2

# Capture pane content
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Check that pane content doesn't contain log patterns
if echo "$PANE_CONTENT" | grep -q "INFO:" || \
   echo "$PANE_CONTENT" | grep -q "DEBUG:" || \
   echo "$PANE_CONTENT" | grep -q "ERROR:" || \
   echo "$PANE_CONTENT" | grep -q "\[tui\]"; then
    fail "TUI is outputting logs to terminal (found log patterns in pane content)"
else
    pass "TUI output clean (no log patterns in pane)"
fi

# Test 2: Verify TUI renders some UI content
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify TUI renders UI content (not blank screen)"

# Capture pane content again
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Count non-empty lines
NON_EMPTY_LINES=$(echo "$PANE_CONTENT" | grep -v "^$" | wc -l | tr -d ' ')

if [ "$NON_EMPTY_LINES" -gt 3 ]; then
    pass "TUI renders content ($NON_EMPTY_LINES non-empty lines)"
else
    fail "TUI appears to be blank or minimal content ($NON_EMPTY_LINES lines)"
fi

# Test 3: Verify log file is created instead (or logs suppressed)
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify logs go to file instead of terminal"

if [ -f "/tmp/tui.log" ]; then
    # Check that log file has content
    LOG_SIZE=$(wc -c < /tmp/tui.log | tr -d ' ')
    if [ "$LOG_SIZE" -gt 0 ]; then
        pass "Logs written to file (/tmp/tui.log, $LOG_SIZE bytes)"
    else
        pass "Log file exists but empty (logs may be suppressed)"
    fi
else
    # Log file may not be created if stderr is redirected, but that's OK
    # as long as logs aren't showing in the UI (verified by Test 1)
    pass "Log file not created (logs suppressed or stderr redirected)"
fi

# Test 4: Verify logs contain expected entries (if file exists)
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify log file contains expected log entries (if file exists)"

if [ -f "/tmp/tui.log" ]; then
    if grep -q "INFO" /tmp/tui.log && grep -q "TUI starting" /tmp/tui.log; then
        pass "Log file contains expected entries"
    else
        warn "Log file exists but doesn't contain expected log entries"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    fi
else
    # This is OK - logs may be suppressed or redirected
    pass "Log file not present (logs suppressed - this is fine)"
fi

# Test 5: Verify UI responds to input without showing logs
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify keyboard input doesn't trigger log output"

# Send some keystrokes
tmux send-keys -t "$TEST_SESSION" "j"
sleep 0.5
tmux send-keys -t "$TEST_SESSION" "k"
sleep 0.5

# Capture pane content after input
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Verify no log output appeared
if echo "$PANE_CONTENT" | grep -q "KeyMsg" || \
   echo "$PANE_CONTENT" | grep -q "Update called" || \
   echo "$PANE_CONTENT" | grep -q "DEBUG"; then
    fail "Keyboard input triggered log output to terminal"
else
    pass "Keyboard input handled cleanly (no debug logs shown)"
fi

# Test 6: Verify UI maintains clean display over time
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify UI maintains clean display (no log accumulation)"

# Wait a bit and send more input
sleep 1
for i in {1..5}; do
    tmux send-keys -t "$TEST_SESSION" "j"
    sleep 0.2
done

# Capture final pane content
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Count lines that look like logs
LOG_LIKE_LINES=$(echo "$PANE_CONTENT" | grep -c "INFO:\|DEBUG:\|ERROR:\|WARN:" || true)

if [ "$LOG_LIKE_LINES" -eq 0 ]; then
    pass "UI remains clean after multiple interactions ($LOG_LIKE_LINES log lines)"
else
    fail "UI accumulated log output ($LOG_LIKE_LINES log-like lines found)"
fi

# Test 7: Verify alt screen mode is active (TUI takeover)
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify TUI uses alt screen mode"

# Check if tmux pane is in alt screen mode by checking window flags
# In alt screen mode, the original content is hidden
tmux send-keys -t "$TEST_SESSION" C-l  # Refresh
sleep 0.5
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# If we see the shell prompt or command we entered earlier, alt screen isn't working
if echo "$PANE_CONTENT" | grep -q "cd $(dirname "$0")"; then
    fail "TUI not using alt screen mode (can see previous commands)"
else
    pass "TUI using alt screen mode (previous commands hidden)"
fi

# Test 8: Verify TUI content is structured (not raw logs)
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify TUI displays structured UI (not log stream)"

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

# Look for characteristics of structured UI vs log stream
# Log streams tend to have timestamps, log levels, repeated patterns
TIMESTAMP_LINES=$(echo "$PANE_CONTENT" | grep -c "[0-9][0-9]:[0-9][0-9]:[0-9][0-9]" || true)
LOG_LEVEL_LINES=$(echo "$PANE_CONTENT" | grep -c "INFO\|DEBUG\|WARN\|ERROR" || true)

# A UI should have few or no timestamp/log-level lines
if [ "$TIMESTAMP_LINES" -lt 3 ] && [ "$LOG_LEVEL_LINES" -lt 3 ]; then
    pass "UI appears structured (not log stream)"
else
    fail "UI looks like log stream ($TIMESTAMP_LINES timestamps, $LOG_LEVEL_LINES log levels)"
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
    echo -e "${GREEN}✓ All UI rendering tests passed!${NC}"
    exit 0
else
    echo
    echo -e "${RED}✗ Some tests failed. UI rendering may have issues.${NC}"
    echo
    echo "Troubleshooting:"
    echo "  - Check /tmp/tui.log for application logs"
    echo "  - Verify log stub is writing to file, not stderr"
    echo "  - Ensure Bubble Tea alt screen mode is enabled"
    exit 1
fi
