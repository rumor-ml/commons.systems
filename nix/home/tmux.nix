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
  # Install tmux-tui auto-load helper script
  home.file.".local/bin/tmux-tui-auto-load".source = ./scripts/tmux-tui-auto-load.sh;

  # Install OSC 52 clipboard integration script
  home.file.".local/bin/copy-osc52" = {
    source = ./scripts/copy-osc52.sh;
    executable = true;
  };

  programs.tmux = {
    enable = true;

    # Set terminal type to support 256 colors
    # Use xterm-256color to match Terminal.app (macOS default terminal)
    # NOTE: Do NOT use tmux-256color - it can cause color mapping issues
    terminal = "xterm-256color";

    # Additional tmux configuration
    extraConfig = ''
      # IMPORTANT: Terminal.app does NOT support true color (24-bit RGB)
      # Do NOT add terminal-overrides with Tc or RGB flags
      # Only iTerm2, Alacritty, Kitty, WezTerm support true color

      # Enable mouse support for scrolling and selection
      set -g mouse on

      # Enable hyperlink support for tmux 3.2+
      set -as terminal-features ",*:hyperlinks"

      # Allow applications to use tmux passthrough sequences
      set -g allow-passthrough on

      # Enable tmux clipboard integration with OSC 52
      set -g set-clipboard on

      # OSC 52 clipboard integration for remote SSH sessions
      # Copy mode keybindings that pipe selection to OSC 52 script
      # Vi copy mode (default)
      bind-key -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel "${config.home.homeDirectory}/.local/bin/copy-osc52"
      bind-key -T copy-mode-vi y send-keys -X copy-pipe-and-cancel "${config.home.homeDirectory}/.local/bin/copy-osc52"
      bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "${config.home.homeDirectory}/.local/bin/copy-osc52"

      # Emacs copy mode
      bind-key -T copy-mode M-w send-keys -X copy-pipe-and-cancel "${config.home.homeDirectory}/.local/bin/copy-osc52"
      bind-key -T copy-mode MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "${config.home.homeDirectory}/.local/bin/copy-osc52"

      # Auto-load project tmux-tui config automatically
      # These hooks ensure the config loads even if tmux starts before direnv
      # Uses a helper script to check and load config as needed

      # Hook: After creating a new window (covers most common workflow)
      set-hook -g after-new-window 'run-shell -b "${config.home.homeDirectory}/.local/bin/tmux-tui-auto-load"'

      # Hook: After attaching to a session (covers tmux attach scenario)
      set-hook -g client-attached 'run-shell -b "${config.home.homeDirectory}/.local/bin/tmux-tui-auto-load"'
    '';
  };
}
