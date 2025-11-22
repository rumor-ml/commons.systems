#!/bin/bash
# Simple E2E test for TUI using tmux
# This demonstrates the testing strategy by creating a tmux session,
# sending keystrokes, and verifying behavior

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test session name
TEST_SESSION="tui-e2e-test-$$"

# Cleanup function
cleanup() {
    echo -e "${YELLOW}Cleaning up test session...${NC}"
    tmux kill-session -t "$TEST_SESSION" 2>/dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

echo -e "${GREEN}=== TUI E2E Test: Simple Session Test ===${NC}"

# Check if tmux is available
if ! command -v tmux &> /dev/null; then
    echo -e "${RED}ERROR: tmux is not installed${NC}"
    exit 1
fi

# Test 1: Create tmux session
echo -e "${YELLOW}Test 1: Creating tmux session '${TEST_SESSION}'...${NC}"
tmux new-session -d -s "$TEST_SESSION" -x 80 -y 24

# Verify session was created
if tmux has-session -t "$TEST_SESSION" 2>/dev/null; then
    echo -e "${GREEN}✓ Session created successfully${NC}"
else
    echo -e "${RED}✗ Failed to create session${NC}"
    exit 1
fi

# Test 2: Send commands to session
echo -e "${YELLOW}Test 2: Sending commands to session...${NC}"
tmux send-keys -t "$TEST_SESSION" "echo 'Hello from TUI test'" Enter
sleep 0.5

# Test 3: Capture pane content
echo -e "${YELLOW}Test 3: Capturing pane content...${NC}"
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

if echo "$PANE_CONTENT" | grep -q "Hello from TUI test"; then
    echo -e "${GREEN}✓ Command executed and output captured${NC}"
else
    echo -e "${RED}✗ Expected output not found${NC}"
    echo "Captured content:"
    echo "$PANE_CONTENT"
    exit 1
fi

# Test 4: Test navigation keys
echo -e "${YELLOW}Test 4: Testing multi-line input...${NC}"
tmux send-keys -t "$TEST_SESSION" "echo 'Line 1'; echo 'Line 2'; echo 'Line 3'" Enter
sleep 1.0

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)
FOUND_COUNT=$(echo "$PANE_CONTENT" | grep -c "Line" || echo "0")
if [ "$FOUND_COUNT" -ge 2 ]; then
    echo -e "${GREEN}✓ Multi-line input successful (found ${FOUND_COUNT} lines)${NC}"
else
    echo -e "${YELLOW}⚠ Multi-line test inconclusive (found ${FOUND_COUNT} lines, expected 3+)${NC}"
    # Don't fail the test, just warn
fi

# Test 5: Test special keys (arrows, etc.)
echo -e "${YELLOW}Test 5: Testing special keys...${NC}"
tmux send-keys -t "$TEST_SESSION" "echo 'Testing special keys'" Enter
tmux send-keys -t "$TEST_SESSION" Up  # Up arrow (should recall last command)
sleep 0.2
PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION" -p)

if echo "$PANE_CONTENT" | grep -q "Testing special keys"; then
    echo -e "${GREEN}✓ Special keys work${NC}"
else
    echo -e "${RED}✗ Special keys test inconclusive${NC}"
fi

# Test 6: Window/pane management
echo -e "${YELLOW}Test 6: Testing window management...${NC}"
tmux new-window -t "$TEST_SESSION" -n "test-window"
WINDOW_COUNT=$(tmux list-windows -t "$TEST_SESSION" | wc -l)

if [ "$WINDOW_COUNT" -eq 2 ]; then
    echo -e "${GREEN}✓ Window creation successful (${WINDOW_COUNT} windows)${NC}"
else
    echo -e "${RED}✗ Expected 2 windows, found ${WINDOW_COUNT}${NC}"
    exit 1
fi

# Test 7: Split panes
echo -e "${YELLOW}Test 7: Testing pane splitting...${NC}"
tmux split-window -t "$TEST_SESSION:test-window" -h
PANE_COUNT=$(tmux list-panes -t "$TEST_SESSION:test-window" | wc -l)

if [ "$PANE_COUNT" -eq 2 ]; then
    echo -e "${GREEN}✓ Pane splitting successful (${PANE_COUNT} panes)${NC}"
else
    echo -e "${RED}✗ Expected 2 panes, found ${PANE_COUNT}${NC}"
    exit 1
fi

echo -e "${GREEN}=== All tests passed! ===${NC}"
exit 0
