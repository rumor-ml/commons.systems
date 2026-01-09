#!/usr/bin/env bash
# Auto-load tmux-tui configuration if available
# This script is called by tmux hooks to load project-specific tmux-tui config

# Exit if not in tmux
[ -z "$TMUX" ] && exit 0

# Exit if keybinding already loaded
if tmux list-keys 2>/dev/null | grep -q "bind-key.*-T root.*C-Space.*spawn.sh"; then
  exit 0
fi

# Get TMUX_TUI_SPAWN_SCRIPT from tmux environment
SPAWN_SCRIPT=$(tmux show-environment -g TMUX_TUI_SPAWN_SCRIPT 2>/dev/null | cut -d= -f2-)

# Exit if not set
[ -z "$SPAWN_SCRIPT" ] && exit 0

# Calculate config path
SPAWN_DIR=$(dirname "$SPAWN_SCRIPT")
CONFIG_DIR=$(dirname "$SPAWN_DIR")
CONFIG_FILE="$CONFIG_DIR/tmux-tui.conf"

# Source config if it exists
if [ -f "$CONFIG_FILE" ]; then
  tmux source-file "$CONFIG_FILE" 2>/dev/null
fi
