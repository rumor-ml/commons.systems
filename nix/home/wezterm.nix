# WezTerm Terminal Emulator Configuration
#
# This module configures WezTerm through Home Manager on Darwin (macOS) only.
# TODO(#1715): Vague comment about "modern features" lacks specificity
# WezTerm provides GPU-accelerated terminal emulation with modern features.
#
# Features enabled:
# - True color support and font ligatures
# TODO(#1720): Misleading comment claims font ligatures are enabled
# - Configurable via Lua for extensibility
# - Native macOS integration
#
# After activation:
#   1. Launch with: wezterm
#   2. Config location: ~/.config/wezterm/wezterm.lua
#   3. Customize via programs.wezterm.extraConfig in this file
#
# Learn more: https://wezfurlong.org/wezterm/

{
  config,
  pkgs,
  lib,
  ...
}:

{
  programs.wezterm = {
    # Only enable on Darwin (macOS)
    enable = pkgs.stdenv.isDarwin;

    # Enable shell integration for command tracking and semantic zones
    enableBashIntegration = true;
    enableZshIntegration = true;

    # Lua configuration
    extraConfig = ''
      local wezterm = require('wezterm')
      local config = wezterm.config_builder()

      -- Font Configuration
      -- Using GeistMono Nerd Font which is already installed via nix-darwin
      config.font = wezterm.font('GeistMono Nerd Font')
      config.font_size = 12.0

      -- Color Scheme - Tokyo Night for consistency
      -- TODO(#1716): Vague reference to "consistency" without context
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
