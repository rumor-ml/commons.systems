{ }:

''
  # tmux-tui configuration
  # Now using Nix-built tmux-tui package with environment variables set by wrapper

  # The tmux-tui binary from Nix has TMUX_TUI_SCRIPTS and TMUX_TUI_CONFIG set
  # Use the Nix package spawn script
  NIX_SPAWN_SCRIPT="$(command -v tmux-tui 2>/dev/null)"
  if [ -n "$NIX_SPAWN_SCRIPT" ]; then
    # Get the scripts directory from the Nix derivation
    NIX_TMUX_TUI_DIR="$(dirname "$(dirname "$NIX_SPAWN_SCRIPT")")/share/tmux-tui"
    NIX_SPAWN_PATH="$NIX_TMUX_TUI_DIR/scripts/spawn.sh"

    # Helper function to detect the correct spawn script path
    _tmux_tui_detect_path() {
      local SPAWN_SCRIPT="$NIX_SPAWN_PATH"

      # Dev override: auto-detect local development version
      # Use local version if either:
      # 1. TMUX_TUI_DEV is explicitly set, OR
      # 2. We're in a git worktree (auto-detect)
      if [ -f "$PWD/tmux-tui/scripts/spawn.sh" ]; then
        # Check if we're in a git worktree (has .git file pointing to main repo)
        if [ -n "$TMUX_TUI_DEV" ] || [ -f "$PWD/.git" ] || ! [ -d "$PWD/.git/refs" ]; then
          SPAWN_SCRIPT="$PWD/tmux-tui/scripts/spawn.sh"
        fi
      fi

      echo "$SPAWN_SCRIPT"
    }

    # Export initial path for later use (whether in tmux or not)
    export TMUX_TUI_SPAWN_SCRIPT="$(_tmux_tui_detect_path)"

    # Define a function to load tmux-tui config (works whether we're in tmux now or later)
    _tmux_tui_maybe_load() {
      if [ -n "$TMUX" ]; then
        # Re-detect path based on current PWD
        local DETECTED_PATH="$(_tmux_tui_detect_path)"

        # Update shell environment variable
        export TMUX_TUI_SPAWN_SCRIPT="$DETECTED_PATH"

        # Get current tmux environment variable (if set)
        CURRENT_TMUX_PATH="$(tmux show-environment -g TMUX_TUI_SPAWN_SCRIPT 2>/dev/null | cut -d= -f2-)"

        # Check if path has changed (or not set yet)
        if [ "$CURRENT_TMUX_PATH" != "$DETECTED_PATH" ]; then
          # Show message when switching to dev version
          if [[ "$DETECTED_PATH" == *"/tmux-tui/scripts/spawn.sh" ]]; then
            echo "Using dev tmux-tui from: $PWD"
          fi

          # Update the global tmux environment variable
          tmux set-environment -g TMUX_TUI_SPAWN_SCRIPT "$DETECTED_PATH" 2>/dev/null

          # Reload config to update keybindings with new path
          TMUX_TUI_CONFIG="''${DETECTED_PATH%/scripts/spawn.sh}/tmux-tui.conf"
          if [ -f "$TMUX_TUI_CONFIG" ]; then
            echo "Reloading tmux-tui configuration..."
            tmux source-file "$TMUX_TUI_CONFIG"
          fi
        fi
      fi
    }

    # Try to load immediately if we're already in tmux
    _tmux_tui_maybe_load

    # Add persistent PROMPT_COMMAND hook to detect Nix store path changes
    # This runs before every prompt to catch when packages are rebuilt
    if [[ "$PROMPT_COMMAND" != *"_tmux_tui_maybe_load"* ]]; then
      if [ -n "$PROMPT_COMMAND" ]; then
        PROMPT_COMMAND="_tmux_tui_maybe_load;$PROMPT_COMMAND"
      else
        PROMPT_COMMAND="_tmux_tui_maybe_load"
      fi
    fi
  fi
''
