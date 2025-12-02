{ pkgs }:

''
  # tmux-tui configuration
  # Now using Nix-built tmux-tui package with environment variables set by wrapper
  if [ -n "$TMUX" ]; then
    # The tmux-tui binary from Nix has TMUX_TUI_SCRIPTS and TMUX_TUI_CONFIG set
    # Use the Nix package spawn script
    NIX_SPAWN_SCRIPT="$(command -v tmux-tui 2>/dev/null)"
    if [ -n "$NIX_SPAWN_SCRIPT" ]; then
      # Get the scripts directory from the Nix derivation
      NIX_TMUX_TUI_DIR="$(dirname "$(dirname "$NIX_SPAWN_SCRIPT")")/share/tmux-tui"
      SPAWN_SCRIPT="$NIX_TMUX_TUI_DIR/scripts/spawn.sh"

      # Dev override: use local version if TMUX_TUI_DEV is set
      if [ -n "$TMUX_TUI_DEV" ] && [ -f "$PWD/tmux-tui/scripts/spawn.sh" ]; then
        SPAWN_SCRIPT="$PWD/tmux-tui/scripts/spawn.sh"
        echo "Using dev tmux-tui from: $PWD"
      fi

      tmux set-environment -g TMUX_TUI_SPAWN_SCRIPT "$SPAWN_SCRIPT"

      # Load config if not already loaded
      if ! tmux show-hooks -g 2>/dev/null | grep -q "run-shell.*spawn.sh"; then
        TMUX_TUI_CONFIG="''${SPAWN_SCRIPT%/scripts/spawn.sh}/tmux-tui.conf"
        if [ -f "$TMUX_TUI_CONFIG" ]; then
          echo "Loading tmux-tui configuration..."
          tmux source-file "$TMUX_TUI_CONFIG"
        fi
      fi
    fi
  fi
''
