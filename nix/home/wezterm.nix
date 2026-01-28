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

    # Use extraConfig to generate Lua configuration with Nix string interpolation
    # This allows platform-specific sections via lib.optionalString
    extraConfig = ''
      local wezterm = require('wezterm')
      local config = wezterm.config_builder()

      config.font = wezterm.font('JetBrains Mono')
      config.font_size = 11.0

      config.color_scheme = 'Tokyo Night'

      config.scrollback_lines = 10000

      config.hide_tab_bar_if_only_one_tab = true

      config.window_padding = {
        left = 2,
        right = 2,
        top = 2,
        bottom = 2,
      }

      ${lib.optionalString pkgs.stdenv.isLinux ''
        -- WSL Integration (Linux/WSL only)
        -- When running on Linux/WSL, include default_prog to automatically
        -- launch into WSL when the Windows WezTerm application reads this config.
        -- Using string concatenation with properly escaped username to handle special characters
        config.default_prog = { 'wsl.exe', '-d', 'NixOS', '--cd', '/home/' .. ${lib.strings.toJSON config.home.username} }
      ''}

      ${lib.optionalString pkgs.stdenv.isDarwin ''
        -- Enable macOS native fullscreen mode
        config.native_macos_fullscreen_mode = true
      ''}

      return config
    '';
  };

  # WSL: Copy config to Windows WezTerm location
  # This activation script runs after Home Manager generates config files
  # and copies them to the Windows user directory where WezTerm on Windows reads it.
  home.activation.copyWeztermToWindows = lib.mkIf pkgs.stdenv.isLinux (
    lib.hm.dag.entryAfter [ "linkGeneration" ] ''
      # Check if running on WSL (Windows mount point exists)
      if [ -d "/mnt/c/Users" ]; then
        # Detect Windows username (may differ from Linux username)
        # Look for a user directory that's not a system directory
        if WINDOWS_USER=$(ls /mnt/c/Users/ 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1) && [ -n "$WINDOWS_USER" ]; then
          # Success - WINDOWS_USER is set
          :
        else
          echo "WARNING: Failed to list /mnt/c/Users/ directory or no valid user found"
          echo "This may indicate a WSL mount or permission issue"
          # Continue without exiting - this is a soft error
          WINDOWS_USER=""
        fi

        if [ -n "$WINDOWS_USER" ] && [ -d "/mnt/c/Users/$WINDOWS_USER" ]; then
          TARGET_DIR="/mnt/c/Users/$WINDOWS_USER"
          TARGET_FILE="$TARGET_DIR/.wezterm.lua"

          # Verify source file exists before copying
          SOURCE_FILE="${config.home.homeDirectory}/.config/wezterm/wezterm.lua"
          if [ ! -f "$SOURCE_FILE" ]; then
            echo "ERROR: Source WezTerm config not found at $SOURCE_FILE"
            echo "Home-Manager may have failed to generate the configuration"
            exit 1
          fi

          # Copy config file with error checking
          if ! $DRY_RUN_CMD cp $VERBOSE_ARG "$SOURCE_FILE" "$TARGET_FILE"; then
            echo "ERROR: Failed to copy WezTerm config to $TARGET_FILE"
            echo "Check permissions, disk space, and ensure WezTerm is not running"
            exit 1
          fi
          echo "Copied WezTerm config to Windows location: $TARGET_FILE"
        else
          echo "WARNING: Running on WSL but could not detect Windows username"
          echo "Available directories in /mnt/c/Users/:"
          if ! ls_output=$(ls -1 /mnt/c/Users/ 2>&1); then
            echo "  Error listing directory: $ls_output"
          else
            echo "$ls_output"
          fi
          echo "To manually copy config, run:"
          echo "  cp ~/.config/wezterm/wezterm.lua /mnt/c/Users/YOUR_USERNAME/.wezterm.lua"
        fi
      else
        echo "Not running on WSL, skipping Windows config copy"
      fi
    ''
  );
}
