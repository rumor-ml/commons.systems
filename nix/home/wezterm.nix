# WezTerm Terminal Emulator Configuration
#
# This module configures WezTerm through Home Manager on Darwin (macOS) only.
# WezTerm provides GPU-accelerated terminal emulation with true color support,
# ligatures, multiplexing, and Lua-based configuration.
#
# Configuration highlights:
# - GeistMono Nerd Font (matching system fonts)
# - Tokyo Night color scheme
# - Native macOS fullscreen mode
# - Shell integration (Bash/Zsh)
#
# After activation:
#   1. Launch with: wezterm
#   2. Config location: ~/.config/wezterm/wezterm.lua
#   3. Customize by editing programs.wezterm.extraConfig below
#
# Learn more: https://wezfurlong.org/wezterm/

{
  pkgs,
  ...
}:

{
  programs.wezterm = {
    # Only enable on Darwin (macOS)
    enable = pkgs.stdenv.isDarwin;

    # Automatically configure shell integration by adding init scripts to shell RC files
    # This enables WezTerm features like:
    # - Jump between prompts with keyboard shortcuts
    # - Copy command output without the prompt
    # - Semantic zone navigation
    enableBashIntegration = true;
    enableZshIntegration = true;

    # Lua configuration in extraConfig
    # Note: Inside the Lua code below, use -- for comments (Lua syntax), not # (Nix syntax)
    extraConfig = ''
      local wezterm = require('wezterm')
      local config = wezterm.config_builder()

      -- Font Configuration
      -- Using GeistMono Nerd Font (installed via nix-darwin in this repo's darwin config)
      -- If using this config elsewhere, ensure the font is installed separately
      config.font = wezterm.font('GeistMono Nerd Font')
      config.font_size = 12.0

      -- Color Scheme
      config.color_scheme = 'Tokyo Night'

      -- Performance and Features
      config.scrollback_lines = 10000
      config.enable_scroll_bar = false

      -- Tab Bar
      config.hide_tab_bar_if_only_one_tab = true
      config.use_fancy_tab_bar = false

      -- Window Appearance
      config.window_padding = {
        left = 4,
        right = 4,
        top = 4,
        bottom = 4,
      }

      -- macOS-specific: Native fullscreen mode
      config.native_macos_fullscreen_mode = true

      -- Disable update checking (managed by Nix)
      config.check_for_updates = false

      return config
    '';
  };
}
