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
EXISTING_TUI_PANE=$(tmux show-window-option -t "$WINDOW_ID" @tui-pane 2>/dev/null | cut -d' ' -f2 | tr -d '"')

# If pane exists, kill it to restart (rebuild and respawn)
if [ -n "$EXISTING_TUI_PANE" ]; then
  if tmux display-message -p -t "$EXISTING_TUI_PANE" "#{pane_id}" >/dev/null 2>&1; then
    tmux kill-pane -t "$EXISTING_TUI_PANE" >/dev/null 2>&1
    tmux set-window-option -t "$WINDOW_ID" -u @tui-pane >/dev/null 2>&1
  fi
fi

# Rebuild binary before spawning
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
(cd "$PROJECT_ROOT" && make build >/dev/null 2>&1)

# Save current pane ID to return focus later
CURRENT_PANE=$(tmux display-message -p "#{pane_id}")

# Create 40-column left pane
tmux split-window -h -b -l 40 -c "#{pane_current_path}" >/dev/null 2>&1 || exit 0

# Get the new pane ID (it will be the pane before the current one)
NEW_PANE=$(tmux display-message -p "#{pane_id}")

# Store TUI pane ID in window option
tmux set-window-option -t "$WINDOW_ID" @tui-pane "$NEW_PANE" >/dev/null 2>&1

# Launch TUI binary (prefer build directory, fallback to PATH)
if [ -f "$PROJECT_ROOT/build/tmux-tui" ]; then
  tmux send-keys -t "$NEW_PANE" "$PROJECT_ROOT/build/tmux-tui" Enter
elif command -v tmux-tui >/dev/null 2>&1; then
  tmux send-keys -t "$NEW_PANE" "tmux-tui" Enter
else
  # Binary not found, clean up and exit
  tmux kill-pane -t "$NEW_PANE" >/dev/null 2>&1
  exit 0
fi

# Return focus to original pane
tmux select-pane -t "$CURRENT_PANE" >/dev/null 2>&1

exit 0
