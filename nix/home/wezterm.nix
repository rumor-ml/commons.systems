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
        -- Using lib.strings.toJSON to wrap username in quotes and escape special characters.
        -- This works because JSON string syntax is valid Lua string syntax.
        -- Nix interpolation happens first, producing: config.default_prog = { 'wsl.exe', '-d', 'NixOS', '--cd', '/home/' .. "username" }
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
        # Pre-check: Verify /mnt/c directory exists
        if [ ! -d "/mnt/c" ]; then
          echo "ERROR: /mnt/c directory does not exist" >&2
          echo "  This system does not appear to be running under WSL" >&2
          echo "  WezTerm configuration sync requires WSL with Windows mount" >&2
          echo "" >&2
          echo "If you are on WSL:" >&2
          echo "  1. Check WSL mount configuration: cat /etc/wsl.conf" >&2
          echo "  2. Ensure automount is enabled" >&2
          echo "  3. Restart WSL: wsl.exe --shutdown (from Windows)" >&2
          exit 1
        elif [ ! -d "/mnt/c/Users" ]; then
          echo "ERROR: /mnt/c/Users directory does not exist" >&2
          echo "  Windows mount exists but Users directory is missing" >&2
          echo "  This is unusual and may indicate Windows filesystem issues" >&2
          exit 1
        elif [ ! -r "/mnt/c/Users" ]; then
          echo "ERROR: Permission denied accessing /mnt/c/Users/" >&2
          echo "  WSL mount exists but directory is not readable" >&2
          echo "" >&2
          echo "To fix:" >&2
          echo "  1. Check mount options: mount | grep /mnt/c" >&2
          echo "  2. Check directory permissions: ls -ld /mnt/c/Users" >&2
          echo "  3. May need to remount with proper permissions" >&2
          exit 1
        fi

        # Auto-detect Windows username by finding first non-system directory in /mnt/c/Users/
        # (does not assume it matches Linux username - simply takes first alphabetically)
        # Look for a user directory that's not a system directory
        if WINDOWS_USER=$(ls /mnt/c/Users/ 2>/dev/null | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1) && [ -n "$WINDOWS_USER" ]; then
          :
        else
          ls_error=$(ls /mnt/c/Users/ 2>&1) || true
          echo "ERROR: Failed to list /mnt/c/Users/ directory" >&2
          echo "  Error: $ls_error" >&2
          echo "  Directory exists and is readable but listing failed unexpectedly" >&2
          exit 1
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
