# Tmux Configuration Module
#
# This module configures tmux settings through Home Manager.
# Note: Home Manager will REPLACE your existing ~/.tmux.conf, not merge with it.
#
# This configuration works alongside nix/hooks/tmux-tui.nix:
# - tmux-tui.nix: Provides the project-specific TUI tool and shell hook
# - This module: Configures tmux terminal settings and general behavior

{ config, pkgs, ... }:

{
  programs.tmux = {
    enable = true;

    # Set terminal type to support 256 colors
    terminal = "tmux-256color";

    # Additional tmux configuration
    extraConfig = ''
      # Enable hyperlink support for tmux 3.2+
      set -as terminal-features ",*:hyperlinks"

      # Allow applications to use tmux passthrough sequences
      set -g allow-passthrough on

      # Project-specific TUI keybinding
      # This references the $TMUX_TUI_SPAWN_SCRIPT environment variable
      # which is set by nix/hooks/tmux-tui.nix when you enter the dev shell.
      # Prefix + t will spawn the project's TUI interface.
      bind-key t run-shell "$TMUX_TUI_SPAWN_SCRIPT"
    '';
  };
}
