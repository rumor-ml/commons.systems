#!/usr/bin/env bash
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

# Step 1: Stop existing daemon and clean up
echo -e "\n${YELLOW}Step 1: Stopping existing daemon and cleaning up...${NC}"

# Extract session name from $TMUX
TMUX_SOCKET=$(echo "$TMUX" | cut -d',' -f1)
SESSION_NAME=$(basename "$TMUX_SOCKET")
NAMESPACE="/tmp/claude/$SESSION_NAME"

# Kill daemon process from lock file first (may be from different worktree)
LOCK_FILE="$NAMESPACE/daemon.lock"
if [ -f "$LOCK_FILE" ]; then
  # Read PID BEFORE removing lock file
  # TODO(#427): Add explicit error checking for lock file read failure
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Killing daemon from lock file (PID: $LOCK_PID)"
    kill -9 "$LOCK_PID" 2>/dev/null || true
    sleep 0.2
    echo -e "${GREEN}✓ Daemon process killed${NC}"
  fi
  # Remove lock file after killing process
  rm -f "$LOCK_FILE"
  echo -e "${GREEN}✓ Lock file removed${NC}"
else
  # No lock file - check for stray daemon processes
  DAEMON_PIDS=$(pgrep -f tmux-tui-daemon || true)
  if [ -n "$DAEMON_PIDS" ]; then
    echo "Killing stray daemon processes: $DAEMON_PIDS"
    # TODO(#427): Verify kill success and report failures to user
    echo "$DAEMON_PIDS" | xargs kill 2>/dev/null || true
    sleep 0.3
    echo -e "${GREEN}✓ Stray daemon processes killed${NC}"
  fi
fi

# Remove socket file if present
DAEMON_SOCKET="$NAMESPACE/daemon.sock"
if [ -S "$DAEMON_SOCKET" ]; then
  rm -f "$DAEMON_SOCKET"
  echo -e "${GREEN}✓ Socket file removed${NC}"
fi

# Wait a moment for cleanup
sleep 0.2

# Step 2: Rebuild binaries
echo -e "\n${YELLOW}Step 2: Rebuilding binaries...${NC}"
cd "$PROJECT_ROOT"
make clean >/dev/null 2>&1
make build
echo -e "${GREEN}✓ Binaries rebuilt${NC}"

# Step 2.5: Start the daemon
echo -e "\n${YELLOW}Step 2.5: Starting daemon...${NC}"
DAEMON_LOG="/tmp/claude/daemon-restart.log"
"$PROJECT_ROOT/build/tmux-tui-daemon" >> "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
sleep 0.5

# TODO(#427): Check both socket existence AND process running state (not just socket)
if [ -S "$DAEMON_SOCKET" ]; then
  echo -e "${GREEN}✓ Daemon started (PID: $DAEMON_PID)${NC}"
else
  echo -e "${RED}Error: Daemon failed to start. Check $DAEMON_LOG for details${NC}"
  if [ -f "$DAEMON_LOG" ]; then
    tail -5 "$DAEMON_LOG"
  fi
fi

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

# Re-fetch window list (some may have closed if TUI pane was the only pane)
CURRENT_WINDOWS=$(tmux list-windows -F "#{window_id}")

for WINDOW_ID in $CURRENT_WINDOWS; do
  # Save current window
  CURRENT_WINDOW=$(tmux display-message -p "#{window_id}")

  # Switch to target window
  tmux select-window -t "$WINDOW_ID" 2>/dev/null || continue

  # Run spawn script with flag to skip auto-claude launch
  TMUX_TUI_RESTART=1 "$SPAWN_SCRIPT"

  # Check if TUI pane was created
  NEW_TUI_PANE=$(tmux show-window-option -t "$WINDOW_ID" @tui-pane 2>/dev/null | cut -d' ' -f2 | tr -d '"' || echo "")
  if [ -n "$NEW_TUI_PANE" ]; then
    echo "Spawned TUI pane $NEW_TUI_PANE in window $WINDOW_ID"
    TUI_PANES_SPAWNED=$((TUI_PANES_SPAWNED + 1))
  fi

  # Return to original window (if it still exists)
  tmux select-window -t "$CURRENT_WINDOW" 2>/dev/null || true
done

echo -e "${GREEN}✓ Spawned $TUI_PANES_SPAWNED TUI pane(s)${NC}"

# Step 5: Set environment variables for keybindings
echo -e "\n${YELLOW}Step 5: Setting environment variables...${NC}"

# Set TMUX_TUI_INSTALL_DIR so keybindings can find tmux-tui-block
tmux set-environment -g TMUX_TUI_INSTALL_DIR "$PROJECT_ROOT/build"
tmux set-environment -g TMUX_TUI_SPAWN_SCRIPT "$PROJECT_ROOT/scripts/spawn.sh"

echo -e "${GREEN}✓ Environment variables set:${NC}"
echo -e "  TMUX_TUI_INSTALL_DIR=$PROJECT_ROOT/build"
echo -e "  TMUX_TUI_SPAWN_SCRIPT=$PROJECT_ROOT/scripts/spawn.sh"

# Re-source tmux config to update keybindings with new paths
tmux source-file "$PROJECT_ROOT/tmux-tui.conf"
echo -e "${GREEN}✓ Keybindings updated${NC}"

# Summary
echo -e "\n${GREEN}=== Done! ===${NC}"
echo -e "Branch: ${YELLOW}$(cd "$PROJECT_ROOT" && git branch --show-current)${NC}"
echo -e "TUI binary: ${YELLOW}$PROJECT_ROOT/build/tmux-tui${NC}"
echo -e "Daemon binary: ${YELLOW}$PROJECT_ROOT/build/tmux-tui-daemon${NC}"
echo -e "\n${GREEN}All TUI panes are now running the version from this branch${NC}"
