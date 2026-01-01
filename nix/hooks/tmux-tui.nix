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
    SPAWN_SCRIPT="$NIX_TMUX_TUI_DIR/scripts/spawn.sh"

    # Dev override: use local version if TMUX_TUI_DEV is set
    if [ -n "$TMUX_TUI_DEV" ] && [ -f "$PWD/tmux-tui/scripts/spawn.sh" ]; then
      SPAWN_SCRIPT="$PWD/tmux-tui/scripts/spawn.sh"
      echo "Using dev tmux-tui from: $PWD"
    fi

    # Export for later use (whether in tmux or not)
    export TMUX_TUI_SPAWN_SCRIPT="$SPAWN_SCRIPT"

    # Define a function to load tmux-tui config (works whether we're in tmux now or later)
    _tmux_tui_maybe_load() {
      if [ -n "$TMUX" ] && [ -n "$TMUX_TUI_SPAWN_SCRIPT" ]; then
        # Set the global tmux environment variable
        tmux set-environment -g TMUX_TUI_SPAWN_SCRIPT "$TMUX_TUI_SPAWN_SCRIPT" 2>/dev/null

        # Load config if not already loaded (check for Ctrl+Space keybinding)
        if ! tmux list-keys 2>/dev/null | grep -q "bind-key.*-T root.*C-Space.*spawn.sh"; then
          TMUX_TUI_CONFIG="''${TMUX_TUI_SPAWN_SCRIPT%/scripts/spawn.sh}/tmux-tui.conf"
          if [ -f "$TMUX_TUI_CONFIG" ]; then
            echo "Loading tmux-tui configuration..."
            tmux source-file "$TMUX_TUI_CONFIG"
          fi
        fi
      fi
    }

    # Try to load immediately if we're already in tmux
    _tmux_tui_maybe_load

    # Add a hook to auto-load when entering tmux later (if not in tmux yet)
    # This uses PROMPT_COMMAND to check once per prompt
    if [ -z "$TMUX" ]; then
      # Add our check to PROMPT_COMMAND (runs before each prompt)
      if [[ "$PROMPT_COMMAND" != *"_tmux_tui_maybe_load"* ]]; then
        # Check once at next prompt, then remove itself
        PROMPT_COMMAND="_tmux_tui_maybe_load_once() { _tmux_tui_maybe_load; PROMPT_COMMAND=\"\''${PROMPT_COMMAND//_tmux_tui_maybe_load_once;/}\"; }; _tmux_tui_maybe_load_once;$PROMPT_COMMAND"
      fi
    fi
  fi
''
