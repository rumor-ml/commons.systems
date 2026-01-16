#!/usr/bin/env bash
# Auto-load tmux-tui configuration if needed
# This script is called by tmux hooks to automatically load the project config
# when TMUX_TUI_SPAWN_SCRIPT is set but the keybindings aren't loaded yet.

# Only proceed if TMUX_TUI_SPAWN_SCRIPT is set
if [ -z "$TMUX_TUI_SPAWN_SCRIPT" ]; then
  exit 0
fi

# Check if the Ctrl+Space keybinding is already loaded
if tmux list-keys 2>/dev/null | grep -q "bind-key.*-T root.*C-Space.*spawn.sh"; then
  # Already loaded, nothing to do
  exit 0
fi

# Config not loaded yet - calculate config path and load it
SPAWN_DIR="$(dirname "$TMUX_TUI_SPAWN_SCRIPT")"
TMUX_TUI_CONFIG="$(dirname "$SPAWN_DIR")/tmux-tui.conf"

if [ -f "$TMUX_TUI_CONFIG" ]; then
  tmux source-file "$TMUX_TUI_CONFIG" 2>/dev/null
fi
