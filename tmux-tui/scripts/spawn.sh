#!/bin/bash
# spawn.sh - Spawn tmux-tui in a 40-column left pane
# Follows tmux-git-window-name pattern

# Check if we're in tmux
if [ -z "$TMUX" ]; then
  exit 0
fi

# Get current window ID
WINDOW_ID=$(tmux display-message -p "#{window_id}")

# Check for existing TUI pane
EXISTING_TUI_PANE=$(tmux show-window-option -t "$WINDOW_ID" @tui-pane 2>/dev/null | cut -d' ' -f2)

# Verify pane still exists (may have crashed or been closed)
if [ -n "$EXISTING_TUI_PANE" ]; then
  if tmux display-message -p -t "$EXISTING_TUI_PANE" "#{pane_id}" >/dev/null 2>&1; then
    # TUI pane already exists and is running
    exit 0
  fi
fi

# Save current pane ID to return focus later
CURRENT_PANE=$(tmux display-message -p "#{pane_id}")

# Create 40-column left pane
tmux split-window -h -b -l 40 -c "#{pane_current_path}" >/dev/null 2>&1 || exit 0

# Get the new pane ID (it will be the pane before the current one)
NEW_PANE=$(tmux display-message -p "#{pane_id}")

# Store TUI pane ID in window option
tmux set-window-option -t "$WINDOW_ID" @tui-pane "$NEW_PANE" >/dev/null 2>&1

# Check if tmux-tui binary is available
if ! command -v tmux-tui >/dev/null 2>&1; then
  # Try to find it in the build directory
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
  if [ -f "$PROJECT_ROOT/build/tmux-tui" ]; then
    # Launch TUI from build directory
    tmux send-keys -t "$NEW_PANE" "$PROJECT_ROOT/build/tmux-tui" Enter
  else
    # Binary not found, clean up and exit
    tmux kill-pane -t "$NEW_PANE" >/dev/null 2>&1
    exit 0
  fi
else
  # Launch TUI using the binary in PATH
  tmux send-keys -t "$NEW_PANE" "tmux-tui" Enter
fi

# Return focus to original pane
tmux select-pane -t "$CURRENT_PANE" >/dev/null 2>&1

exit 0
