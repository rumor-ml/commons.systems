# WezTerm Configuration Module
#
# This module configures WezTerm terminal emulator through Home Manager.
# On WSL, it automatically copies the configuration to the Windows WezTerm
# location so the Windows WezTerm installation uses this config.
#
# Platform-specific behavior:
# - Linux (WSL): Includes default_prog to launch WSL, copies config to Windows
# - macOS: Includes native fullscreen mode setting
# - All: Common settings for fonts, colors, scrollback, etc.

{
  config,
  pkgs,
  lib,
  ...
}:

{
  programs.wezterm = {
    enable = true;

    # Generate comprehensive WezTerm configuration
    extraConfig = ''
      local wezterm = require('wezterm')
      local config = wezterm.config_builder()

      -- Font Configuration
      config.font = wezterm.font('JetBrains Mono')
      config.font_size = 11.0

      -- Color Scheme
      config.color_scheme = 'Tokyo Night'

      -- Scrollback
      config.scrollback_lines = 10000

      -- Tab Bar
      config.hide_tab_bar_if_only_one_tab = true

      -- Window Padding
      config.window_padding = {
        left = 2,
        right = 2,
        top = 2,
        bottom = 2,
      }

      ${lib.optionalString pkgs.stdenv.isLinux ''
        -- WSL Integration (Linux/WSL only)
        -- Configure default program to launch WSL when running WezTerm on Windows
        config.default_prog = { 'wsl.exe', '-d', 'NixOS', '--cd', '/home/${config.home.username}' }
      ''}

      ${lib.optionalString pkgs.stdenv.isDarwin ''
        -- macOS Native Fullscreen (macOS only)
        config.native_macos_fullscreen_mode = true
      ''}

      return config
    '';
  };

  # WSL: Copy config to Windows WezTerm location
  # This activation script runs after home-manager generates the config file
  # and copies it to the Windows user directory where WezTerm on Windows reads it.
  home.activation.copyWeztermToWindows = lib.mkIf pkgs.stdenv.isLinux (
    lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      # Check if running on WSL (Windows mount point exists)
      if [ -d "/mnt/c/Users" ]; then
        # Detect Windows username (may differ from Linux username)
        # Look for a user directory that's not a system directory
        WINDOWS_USER=$(ls /mnt/c/Users/ 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

        if [ -n "$WINDOWS_USER" ] && [ -d "/mnt/c/Users/$WINDOWS_USER" ]; then
          TARGET_DIR="/mnt/c/Users/$WINDOWS_USER"
          TARGET_FILE="$TARGET_DIR/.wezterm.lua"

          # Ensure target directory exists (though it should already)
          if [ ! -d "$TARGET_DIR" ]; then
            $DRY_RUN_CMD mkdir -p $VERBOSE_ARG "$TARGET_DIR"
          fi

          # Copy config file
          $DRY_RUN_CMD cp $VERBOSE_ARG \
            "${config.home.homeDirectory}/.config/wezterm/wezterm.lua" \
            "$TARGET_FILE"
          echo "Copied WezTerm config to Windows location: $TARGET_FILE"
        else
          echo "Could not detect Windows username, skipping config copy"
        fi
      else
        echo "Not running on WSL, skipping Windows config copy"
      fi
    ''
  );
}
