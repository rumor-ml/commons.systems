#!/bin/bash
# restart-tui.sh - Restart tmux-tui daemon and all TUI panes for manual testing
# This script rebuilds the binaries from the current branch and restarts everything

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Restarting tmux-tui ===${NC}"

# Check if we're in tmux
if [ -z "$TMUX" ]; then
  echo -e "${RED}Error: Must be run from within tmux${NC}"
  exit 1
fi

# Get project root (assuming script is run from repo root or tmux-tui dir)
if [ -d "tmux-tui" ]; then
  PROJECT_ROOT="$(pwd)/tmux-tui"
elif [ -f "cmd/tmux-tui/main.go" ]; then
  PROJECT_ROOT="$(pwd)"
else
  echo -e "${RED}Error: Cannot find tmux-tui project root${NC}"
  echo "Run this script from either the repo root or the tmux-tui directory"
  exit 1
fi

echo -e "${GREEN}Project root: $PROJECT_ROOT${NC}"

# Step 1: Stop existing daemon
echo -e "\n${YELLOW}Step 1: Stopping existing daemon...${NC}"

# Extract session name from $TMUX
TMUX_SOCKET=$(echo "$TMUX" | cut -d',' -f1)
SESSION_NAME=$(basename "$TMUX_SOCKET")
DAEMON_PID_FILE="/tmp/claude/$SESSION_NAME/daemon.pid"

if [ -f "$DAEMON_PID_FILE" ]; then
  DAEMON_PID=$(cat "$DAEMON_PID_FILE")
  if kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "Killing daemon (PID: $DAEMON_PID)"
    kill "$DAEMON_PID" 2>/dev/null || true
    sleep 0.5
  fi
  rm -f "$DAEMON_PID_FILE"
  echo -e "${GREEN}✓ Daemon stopped${NC}"
else
  echo "No daemon PID file found (may not be running)"
fi

# Clean up socket too
DAEMON_SOCKET="/tmp/claude/$SESSION_NAME/daemon.sock"
if [ -S "$DAEMON_SOCKET" ]; then
  rm -f "$DAEMON_SOCKET"
fi

# Step 2: Rebuild binaries
echo -e "\n${YELLOW}Step 2: Rebuilding binaries...${NC}"
cd "$PROJECT_ROOT"
make clean >/dev/null 2>&1
make build
echo -e "${GREEN}✓ Binaries rebuilt${NC}"

# Step 3: Kill all existing TUI panes
echo -e "\n${YELLOW}Step 3: Killing existing TUI panes...${NC}"

# Find all windows with TUI panes
WINDOWS=$(tmux list-windows -F "#{window_id}")
TUI_PANES_KILLED=0

for WINDOW_ID in $WINDOWS; do
  # Get the @tui-pane option for this window
  TUI_PANE=$(tmux show-window-option -t "$WINDOW_ID" @tui-pane 2>/dev/null | cut -d' ' -f2 | tr -d '"' || echo "")

  if [ -n "$TUI_PANE" ]; then
    # Check if pane still exists
    if tmux display-message -p -t "$TUI_PANE" "#{pane_id}" >/dev/null 2>&1; then
      echo "Killing TUI pane $TUI_PANE in window $WINDOW_ID"
      tmux kill-pane -t "$TUI_PANE" 2>/dev/null || true
      TUI_PANES_KILLED=$((TUI_PANES_KILLED + 1))
    fi
    # Clear the window option
    tmux set-window-option -t "$WINDOW_ID" -u @tui-pane 2>/dev/null || true
  fi
done

echo -e "${GREEN}✓ Killed $TUI_PANES_KILLED TUI pane(s)${NC}"

# Step 4: Respawn TUI panes
echo -e "\n${YELLOW}Step 4: Respawning TUI panes...${NC}"

SPAWN_SCRIPT="$PROJECT_ROOT/scripts/spawn.sh"
if [ ! -f "$SPAWN_SCRIPT" ]; then
  echo -e "${RED}Error: spawn.sh not found at $SPAWN_SCRIPT${NC}"
  exit 1
fi

TUI_PANES_SPAWNED=0

for WINDOW_ID in $WINDOWS; do
  # Save current window
  CURRENT_WINDOW=$(tmux display-message -p "#{window_id}")

  # Switch to target window
  tmux select-window -t "$WINDOW_ID"

  # Run spawn script
  "$SPAWN_SCRIPT"

  # Check if TUI pane was created
  NEW_TUI_PANE=$(tmux show-window-option -t "$WINDOW_ID" @tui-pane 2>/dev/null | cut -d' ' -f2 | tr -d '"' || echo "")
  if [ -n "$NEW_TUI_PANE" ]; then
    echo "Spawned TUI pane $NEW_TUI_PANE in window $WINDOW_ID"
    TUI_PANES_SPAWNED=$((TUI_PANES_SPAWNED + 1))
  fi

  # Return to original window
  tmux select-window -t "$CURRENT_WINDOW"
done

echo -e "${GREEN}✓ Spawned $TUI_PANES_SPAWNED TUI pane(s)${NC}"

# Summary
echo -e "\n${GREEN}=== Done! ===${NC}"
echo -e "Branch: ${YELLOW}$(cd "$PROJECT_ROOT" && git branch --show-current)${NC}"
echo -e "TUI binary: ${YELLOW}$PROJECT_ROOT/build/tmux-tui${NC}"
echo -e "Daemon binary: ${YELLOW}$PROJECT_ROOT/build/tmux-tui-daemon${NC}"
echo -e "\n${GREEN}All TUI panes are now running the version from this branch${NC}"
