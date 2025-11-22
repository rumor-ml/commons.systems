#!/bin/sh
# Script to navigate to TUI and mark the source project as testing
# This script is called from Claude panes via ctrl-b t

# Get current pane info to identify which project to mark
CURRENT_SESSION=$(tmux display-message -p "#{session_name}")
CURRENT_WINDOW=$(tmux display-message -p "#{window_index}")

# Flag to track if we found TUI
found_tui=0
target_session=""
target_window=""
target_pane=""

# Get all panes with their info and process them
for line in $(tmux list-panes -a -F "#{session_name}:#{window_index}:#{pane_index}:#{pane_current_command}:#{pane_current_path}"); do
    session=$(echo "$line" | cut -d: -f1)
    window=$(echo "$line" | cut -d: -f2)
    pane=$(echo "$line" | cut -d: -f3)
    cmd=$(echo "$line" | cut -d: -f4)
    path=$(echo "$line" | cut -d: -f5)

    # Check if this is TUI (either binary or go run in tui dir)
    if [ "$cmd" = "tui" ]; then
        # Found TUI binary
        found_tui=1
        target_session="$session"
        target_window="$window"
        target_pane="$pane"
        break
    elif [ "$cmd" = "go" ] && echo "$path" | grep -q "/tui$"; then
        # Found go run in tui directory
        found_tui=1
        target_session="$session"
        target_window="$window"
        target_pane="$pane"
        break
    fi
done

if [ "$found_tui" = "1" ]; then
    # Get the PID of the process running in the TUI pane
    TUI_PANE_PID=$(tmux display-message -p -t "$target_session:$target_window.$target_pane" '#{pane_pid}')

    # Find the actual TUI executable process
    # For 'go run main.go', we need to find the child of 'go run', not 'go run' itself
    # For './tui', the binary runs directly

    # Strategy: Look for process with 'tui' in command OR '/exe/main' (go build temp executable)
    # Use ps to get all descendants and filter
    TUI_PID=""

    # First try: direct children and grandchildren
    for pid in $(pgrep -P "$TUI_PANE_PID" 2>/dev/null); do
        # Check if this PID is the TUI binary
        cmd=$(ps -p "$pid" -o command= 2>/dev/null)
        if echo "$cmd" | grep -qE '/tui$|/main$'; then
            TUI_PID="$pid"
            break
        fi

        # If not, check its children (for go run -> exe/main case)
        for child_pid in $(pgrep -P "$pid" 2>/dev/null); do
            child_cmd=$(ps -p "$child_pid" -o command= 2>/dev/null)
            if echo "$child_cmd" | grep -qE '/tui$|/main$'; then
                TUI_PID="$child_pid"
                break 2
            fi
        done
    done

    # If still not found, check if pane PID itself is the TUI
    if [ -z "$TUI_PID" ]; then
        cmd=$(ps -p "$TUI_PANE_PID" -o command= 2>/dev/null)
        if echo "$cmd" | grep -qE '/tui$|/main$'; then
            TUI_PID="$TUI_PANE_PID"
        fi
    fi

    if [ -z "$TUI_PID" ]; then
        tmux display-message "TUI executable not found (pane PID: $TUI_PANE_PID)"
        exit 1
    fi

    # Write PID-specific marker file with source session/window info for TUI to pick up
    MARKER_DIR="/tmp/tui-testing-markers"
    mkdir -p "$MARKER_DIR"
    echo "$CURRENT_SESSION:$CURRENT_WINDOW" > "$MARKER_DIR/mark-testing-request-$TUI_PID"

    # Navigate to the found TUI
    tmux switch-client -t "$target_session" 2>/dev/null || true
    tmux select-window -t "$target_session:$target_window"
    tmux select-pane -t "$target_session:$target_window.$target_pane"
    exit 0
fi

# No TUI found - show error message
tmux display-message "TUI not found - cannot mark as testing"
exit 1
