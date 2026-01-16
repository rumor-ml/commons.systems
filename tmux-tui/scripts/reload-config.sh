#!/usr/bin/env bash
# Reload tmux-tui configuration in the current tmux session
# Useful when the Nix shellHook didn't run properly or after updates

set -e

if [ -z "$TMUX" ]; then
  echo "Error: Not in a tmux session"
  exit 1
fi

# Find the tmux-tui binary from Nix
NIX_SPAWN_SCRIPT="$(command -v tmux-tui 2>/dev/null)"
if [ -z "$NIX_SPAWN_SCRIPT" ]; then
  echo "Error: tmux-tui not found. Make sure you're in the Nix shell (direnv should load it automatically)"
  exit 1
fi

# Calculate paths
NIX_TMUX_TUI_DIR="$(dirname "$(dirname "$NIX_SPAWN_SCRIPT")")/share/tmux-tui"
SPAWN_SCRIPT="$NIX_TMUX_TUI_DIR/scripts/spawn.sh"

# Dev override: use local version if TMUX_TUI_DEV is set
if [ -n "$TMUX_TUI_DEV" ] && [ -f "$PWD/tmux-tui/scripts/spawn.sh" ]; then
  SPAWN_SCRIPT="$PWD/tmux-tui/scripts/spawn.sh"
  echo "Using dev tmux-tui from: $PWD"
fi

# Verify spawn script exists
if [ ! -f "$SPAWN_SCRIPT" ]; then
  echo "Error: Spawn script not found at $SPAWN_SCRIPT"
  exit 1
fi

# Set environment variable
echo "Setting TMUX_TUI_SPAWN_SCRIPT=$SPAWN_SCRIPT"
tmux set-environment -g TMUX_TUI_SPAWN_SCRIPT "$SPAWN_SCRIPT"

# Find and source config file
TMUX_TUI_CONFIG="${SPAWN_SCRIPT%/scripts/spawn.sh}/tmux-tui.conf"
if [ ! -f "$TMUX_TUI_CONFIG" ]; then
  echo "Error: Config file not found at $TMUX_TUI_CONFIG"
  exit 1
fi

echo "Sourcing tmux config from $TMUX_TUI_CONFIG"
tmux source-file "$TMUX_TUI_CONFIG"

echo ""
echo "✓ tmux-tui configuration reloaded successfully"
echo ""
echo "Keybindings:"
echo "  Ctrl+Space - Spawn/reopen TUI"
echo "  Prefix+B   - Toggle block state"
echo ""
echo "Verify with: tmux list-keys | grep -i C-Space"
