#!/usr/bin/env bash
# spawn.sh - Spawn tmux-tui in a 40-column left pane
# Follows tmux-git-window-name pattern
#
# Environment variables (set by after-new-window hook):
#   TMUX_NEW_WINDOW_HOOK=1 - indicates called from new-window hook
#   HOOK_WINDOW - the window ID from the hook

# Check if we're in tmux
if [ -z "$TMUX" ]; then
  exit 0
fi

# Get the target window ID
WINDOW_ID=$(tmux display-message -p "#{window_id}")

# Detect if this is a new window by checking pane count
# A new window will have exactly 1 pane before we split
PANE_COUNT=$(tmux list-panes -t "$WINDOW_ID" | wc -l | tr -d ' ')
IS_NEW_WINDOW=0
if [ "$PANE_COUNT" = "1" ]; then
  IS_NEW_WINDOW=1
fi

echo "$(date): WINDOW_ID=$WINDOW_ID PANE_COUNT=$PANE_COUNT IS_NEW_WINDOW=$IS_NEW_WINDOW" >> /tmp/claude/spawn-debug.log

# Check for existing TUI pane
EXISTING_TUI_PANE=$(tmux show-window-option -t "$WINDOW_ID" @tui-pane 2>/dev/null | cut -d' ' -f2 | tr -d '"')

# If pane exists and is valid, kill it and exit (toggle off)
if [ -n "$EXISTING_TUI_PANE" ]; then
  if tmux display-message -p -t "$EXISTING_TUI_PANE" "#{pane_id}" >/dev/null 2>&1; then
    tmux kill-pane -t "$EXISTING_TUI_PANE" >/dev/null 2>&1
    tmux set-window-option -t "$WINDOW_ID" -u @tui-pane >/dev/null 2>&1
    exit 0  # Toggle off - don't recreate
  fi
fi

# Rebuild binaries before spawning
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
if ! (cd "$PROJECT_ROOT" && make build >/dev/null 2>&1); then
  echo "$(date): ERROR: Build failed in $PROJECT_ROOT" >> /tmp/claude/spawn-debug.log
  # TODO(#427): Verify cached binary exists before proceeding
  tmux display-message -d 3000 "WARNING: tmux-tui build failed - using cached binary" 2>/dev/null || true
fi

# Start daemon if not already running
# Daemon has built-in singleton enforcement via lock file, safe to attempt from any worktree
DAEMON_BIN="$PROJECT_ROOT/build/tmux-tui-daemon"
if [ -f "$DAEMON_BIN" ]; then
  # Daemon auto-detects namespace from $TMUX
  # It will exit immediately if already running (via lock file)
  "$DAEMON_BIN" >> /tmp/claude/daemon-output.log 2>&1 &
  DAEMON_PID=$!
  sleep 0.3
  # TODO(#427): Add tmux display message for daemon start failures (not just log to file)
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "$(date): ERROR: Daemon failed to start (check /tmp/claude/daemon-output.log)" >> /tmp/claude/spawn-debug.log
  fi
fi

# Get the current pane in THIS window (before split, there's only one pane)
CURRENT_PANE=$(tmux list-panes -t "$WINDOW_ID" -F "#{pane_id}" | head -1)

echo "$(date): WINDOW_ID=$WINDOW_ID CURRENT_PANE=$CURRENT_PANE" >> /tmp/claude/spawn-debug.log

# Create 40-column left pane and capture its ID
NEW_PANE=$(tmux split-window -h -b -l 40 -t "$WINDOW_ID" -c "#{pane_current_path}" -P -F "#{pane_id}") || exit 0

echo "$(date): NEW_PANE=$NEW_PANE" >> /tmp/claude/spawn-debug.log

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

# Run claude in the main pane ONLY when called from after-new-window hook
# Skip if called from restart-tui.sh (TMUX_TUI_RESTART=1)
if [ "$TMUX_NEW_WINDOW_HOOK" = "1" ] && [ "$TMUX_TUI_RESTART" != "1" ]; then
  echo "$(date): Running claude in CURRENT_PANE=$CURRENT_PANE (new window hook)" >> /tmp/claude/spawn-debug.log
  tmux send-keys -t "$CURRENT_PANE" "claude || exec zsh" Enter
else
  echo "$(date): Skipping claude (TMUX_NEW_WINDOW_HOOK=$TMUX_NEW_WINDOW_HOOK, TMUX_TUI_RESTART=$TMUX_TUI_RESTART)" >> /tmp/claude/spawn-debug.log
fi

# Return focus to original pane
tmux select-pane -t "$CURRENT_PANE" >/dev/null 2>&1

exit 0
