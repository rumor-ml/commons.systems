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
        -- When this config is generated on WSL, include default_prog to automatically
        -- launch into WSL when the Windows WezTerm application reads this config.
        config.default_prog = { 'wsl.exe', '-d', 'NixOS', '--cd', '/home/${config.home.username}' }
      ''}

      ${lib.optionalString pkgs.stdenv.isDarwin ''
        -- Enable macOS native fullscreen mode
        config.native_macos_fullscreen_mode = true
      ''}

      return config
    '';
  };

  # WSL: Copy config to Windows WezTerm location
  # This activation script runs after home-manager generates the config file
  # (linkGeneration ensures all configuration files are symlinked before this runs)
  # and copies it to the Windows user directory where WezTerm on Windows reads it.
  home.activation.copyWeztermToWindows = lib.mkIf pkgs.stdenv.isLinux (
    lib.hm.dag.entryAfter [ "linkGeneration" ] ''
      # Check if running on WSL (Windows mount point exists)
      if [ -d "/mnt/c/Users" ]; then
        # Detect Windows username (may differ from Linux username)
        # Look for a user directory that's not a system directory
        # Check if we can list the directory first
        if ! ls /mnt/c/Users/ >/tmp/wezterm-users-list 2>&1; then
          echo "WARNING: Failed to list /mnt/c/Users/ directory"
          cat /tmp/wezterm-users-list
          rm -f /tmp/wezterm-users-list
          echo "This may indicate a WSL mount or permission issue"
          # Continue without exiting - this is a soft error
          WINDOWS_USER=""
        else
          WINDOWS_USER=$(grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' /tmp/wezterm-users-list | head -n1)
          rm -f /tmp/wezterm-users-list
        fi

        if [ -n "$WINDOWS_USER" ] && [ -d "/mnt/c/Users/$WINDOWS_USER" ]; then
          TARGET_DIR="/mnt/c/Users/$WINDOWS_USER"
          TARGET_FILE="$TARGET_DIR/.wezterm.lua"

          # Create target directory if it doesn't exist (defensive check for non-standard WSL setups)
          if [ ! -d "$TARGET_DIR" ]; then
            if ! $DRY_RUN_CMD mkdir -p $VERBOSE_ARG "$TARGET_DIR"; then
              echo "ERROR: Failed to create directory $TARGET_DIR"
              echo "Check permissions and filesystem status"
              exit 1
            fi
          fi

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
          ls -1 /mnt/c/Users/ 2>/dev/null || echo "  (unable to list)"
          echo "To manually copy config, run:"
          echo "  cp ~/.config/wezterm/wezterm.lua /mnt/c/Users/YOUR_USERNAME/.wezterm.lua"
        fi
      else
        echo "Not running on WSL, skipping Windows config copy"
      fi
    ''
  );
}
