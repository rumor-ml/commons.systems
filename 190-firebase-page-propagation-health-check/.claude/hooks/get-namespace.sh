#!/bin/bash
# get-namespace.sh - Extract tmux session namespace from $TMUX environment variable
# Returns the namespace directory where alert files should be written

# Parse $TMUX to extract socket name
# Format: /tmp/tmux-1000/default,12345,0
if [ -n "$TMUX" ]; then
  # Split on comma to get socket path
  SOCKET_PATH="${TMUX%%,*}"
  # Get basename of socket path (e.g., "default" or "e2e-test-123")
  SOCKET_NAME="$(basename "$SOCKET_PATH")"
  echo "/tmp/claude/$SOCKET_NAME"
else
  # Fallback to default
  echo "/tmp/claude/default"
fi
