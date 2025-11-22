#!/bin/bash
# Script to navigate to TUI pane or create new one

# Check if TUI is running via instance lock (most reliable)
check_tui_running() {
    # Use $TMPDIR if set (macOS user temp), fallback to /tmp
    local tmpdir="${TMPDIR:-/tmp}"
    # Remove trailing slash if present
    tmpdir="${tmpdir%/}"
    [ -S "${tmpdir}/tui-instance.sock" ]
}

# Find TUI pane using pane_current_command detection
find_tui_pane() {
    tmux list-panes -a -F "#{session_name}:#{window_index}:#{pane_index}:#{pane_current_command}:#{pane_current_path}" | while IFS=: read -r session window pane cmd path; do
        # Check if this is TUI (either binary or go run in tui dir)
        if [ "$cmd" = "tui" ]; then
            echo "$session:$window:$pane"
            exit 0
        elif [ "$cmd" = "go" ] && echo "$path" | grep -q "/tui$"; then
            echo "$session:$window:$pane"
            exit 0
        fi
    done
}

# First check: Is TUI running at all? (most reliable check)
if ! check_tui_running; then
    # TUI not running - launch it in a new window
    # Find the TUI binary
    TUI_BIN=""
    if [ -x "/Users/n8/carriercommons/tui/tui" ]; then
        TUI_BIN="/Users/n8/carriercommons/tui/tui"
    elif command -v tui >/dev/null 2>&1; then
        TUI_BIN="tui"
    fi

    if [ -z "$TUI_BIN" ]; then
        tmux display-message "TUI not found - please build or install TUI first"
        exit 1
    fi

    # Get current session
    current_session=$(tmux display-message -p '#{session_name}')

    # Create new window named "tui" in current session
    tmux new-window -t "$current_session" -n "tui" "$TUI_BIN"

    # Display message and exit successfully
    tmux display-message "Launched new TUI in window 'tui'"
    exit 0
fi

# TUI is running (lock exists), now find its pane
TUI_PANE=$(find_tui_pane)

if [ -z "$TUI_PANE" ]; then
    # Lock exists but pane not found - retry after brief delay
    # (handles timing issue where tmux hasn't updated pane_current_command yet)
    sleep 0.3
    TUI_PANE=$(find_tui_pane)
fi

if [ -z "$TUI_PANE" ]; then
    # Still not found - stale lock detected
    tmpdir="${TMPDIR:-/tmp}"
    tmpdir="${tmpdir%/}"
    lock_file="${tmpdir}/tui-instance.sock"

    # Clean up stale lock
    rm -f "$lock_file"
    tmux display-message "Stale TUI lock removed, launching new TUI..."

    # Find the TUI binary
    TUI_BIN=""
    if [ -x "/Users/n8/carriercommons/tui/tui" ]; then
        TUI_BIN="/Users/n8/carriercommons/tui/tui"
    elif command -v tui >/dev/null 2>&1; then
        TUI_BIN="tui"
    fi

    if [ -z "$TUI_BIN" ]; then
        tmux display-message "TUI not found - please build or install TUI first"
        exit 1
    fi

    # Get current session
    current_session=$(tmux display-message -p '#{session_name}')

    # Create new window named "tui" in current session
    tmux new-window -t "$current_session" -n "tui" "$TUI_BIN"
    exit 0
fi

# Extract session, window, and pane from result (format: session:window:pane)
target_session=$(echo "$TUI_PANE" | cut -d: -f1)
target_window=$(echo "$TUI_PANE" | cut -d: -f2)
target_pane=$(echo "$TUI_PANE" | cut -d: -f3)

# Navigate to the found TUI
tmux switch-client -t "$target_session" 2>/dev/null || true
tmux select-window -t "$target_session:$target_window"
tmux select-pane -t "$target_session:$target_window.$target_pane"
exit 0