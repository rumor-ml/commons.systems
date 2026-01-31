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
        -- Using lib.strings.toJSON to wrap username in quotes and escape special characters
        -- to prevent Lua syntax errors or injection from special characters.
        -- This is critical for usernames containing: single quotes ('), double quotes ("), backslashes (\), or bracket sequences (]])
        -- JSON string syntax is valid Lua string syntax, making this a safe escaping mechanism.
        -- Example: if config.home.username = "alice", Nix interpolation produces:
        --   config.default_prog = { 'wsl.exe', '-d', 'NixOS', '--cd', '/home/' .. "alice" }
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
  # This activation script runs after Home Manager generates config files.
  # DAG ordering: Must run after "linkGeneration" to ensure the source file
  # (~/.config/wezterm/wezterm.lua) exists before attempting to copy it to Windows.
  home.activation.copyWeztermToWindows = lib.mkIf pkgs.stdenv.isLinux (
    lib.hm.dag.entryAfter [ "linkGeneration" ] ''
      # Define error codes for different failure modes
      # These structured exit codes enable programmatic error handling by callers
      readonly ERR_PERMISSION_DENIED=11
      readonly ERR_USERNAME_DETECTION=12
      readonly ERR_SOURCE_MISSING=13
      readonly ERR_SOURCE_EMPTY=15
      readonly ERR_COPY_FAILED=14

      # Check if running on WSL (Windows mount point exists)
      if [ -d "/mnt/c/Users" ]; then
        # Verify /mnt/c/Users is readable
        if [ ! -r "/mnt/c/Users" ]; then
          echo "ERROR: Permission denied accessing /mnt/c/Users/" >&2
          echo "  WSL mount exists but directory is not readable" >&2
          echo "" >&2
          echo "To fix:" >&2
          echo "  1. Check mount options: mount | grep /mnt/c" >&2
          echo "  2. Check directory permissions: ls -ld /mnt/c/Users" >&2
          echo "  3. May need to remount with proper permissions" >&2
          exit $ERR_PERMISSION_DENIED
        fi

        # Auto-detect Windows username by finding first non-system directory in /mnt/c/Users/
        # (filters out system directories like Public, Default User; does not require Windows username to match Linux username)
        # Pre-checks above ensure /mnt/c/Users exists and is readable
        # Capture ls output and stderr separately to provide better error diagnostics
        # This allows distinguishing between command failure and empty output
        LS_STDERR=$(mktemp)
        trap 'rm -f "$LS_STDERR"' EXIT  # Ensure cleanup even on error exit
        LS_OUTPUT=$(ls /mnt/c/Users/ 2>"$LS_STDERR")
        LS_EXIT_CODE=$?

        if [ $LS_EXIT_CODE -ne 0 ]; then
          echo "ERROR: Failed to list /mnt/c/Users/ directory" >&2
          echo "  Exit code: $LS_EXIT_CODE" >&2
          if [ -s "$LS_STDERR" ]; then
            echo "  Error output:" >&2
            cat "$LS_STDERR" | sed 's/^/    /' >&2
          fi
          echo "  Check permissions and mount status" >&2
          ls -ld /mnt/c/Users/ 2>&1 || true  # Show diagnostic info
          exit $ERR_PERMISSION_DENIED
        fi

        WINDOWS_USER=$(echo "$LS_OUTPUT" | grep -v -E '^(All Users|Default|Default User|Public|desktop.ini)$' | head -n1)

        if [ -z "$WINDOWS_USER" ]; then
          echo "ERROR: Failed to detect Windows username" >&2
          echo "  Directory is readable but no valid user directories found" >&2
          echo "  Available directories:" >&2
          echo "$LS_OUTPUT" | sed 's/^/    /' >&2
          exit $ERR_USERNAME_DETECTION
        fi

        if [ -n "$WINDOWS_USER" ] && [ -d "/mnt/c/Users/$WINDOWS_USER" ]; then
          TARGET_DIR="/mnt/c/Users/$WINDOWS_USER"
          TARGET_FILE="$TARGET_DIR/.wezterm.lua"

          # Verify source file exists before copying
          SOURCE_FILE="${config.home.homeDirectory}/.config/wezterm/wezterm.lua"
          if [ ! -f "$SOURCE_FILE" ]; then
            echo "ERROR: Source WezTerm config not found at $SOURCE_FILE" >&2
            echo "Home-Manager may have failed to generate the configuration" >&2
            exit $ERR_SOURCE_MISSING
          fi

          # Verify source file is not empty
          if [ ! -s "$SOURCE_FILE" ]; then
            echo "ERROR: Source WezTerm config is empty at $SOURCE_FILE" >&2
            echo "This may indicate:" >&2
            echo "  - Home-Manager configuration has empty extraConfig" >&2
            echo "  - File generation failed or was truncated" >&2
            echo "  - Accidental empty string in programs.wezterm.extraConfig" >&2
            exit $ERR_SOURCE_EMPTY
          fi

          # Copy config file with error checking
          if ! $DRY_RUN_CMD cp $VERBOSE_ARG "$SOURCE_FILE" "$TARGET_FILE"; then
            echo "ERROR: Failed to copy WezTerm config to $TARGET_FILE" >&2
            echo "Check permissions, disk space, and ensure WezTerm is not running" >&2
            exit $ERR_COPY_FAILED
          fi
          echo "Copied WezTerm config to Windows location: $TARGET_FILE"
        else
          # User was detected but directory doesn't exist - this is an error state
          echo "ERROR: Detected Windows username '$WINDOWS_USER' but directory does not exist" >&2
          echo "  Expected directory: /mnt/c/Users/$WINDOWS_USER" >&2
          echo "" >&2

          # Diagnostic output - if this fails, it indicates a critical filesystem issue
          if ! ls_output=$(ls -1 /mnt/c/Users/ 2>&1); then
            echo "ERROR: Additionally, cannot list /mnt/c/Users/ for diagnostics" >&2
            echo "  Directory passed initial checks but is now inaccessible" >&2
            echo "  This indicates a filesystem or permission issue" >&2
            echo "  Error: $ls_output" >&2
            exit $ERR_USERNAME_DETECTION
          fi

          echo "Available directories in /mnt/c/Users/:" >&2
          echo "$ls_output" | sed 's/^/  /' >&2
          echo "" >&2
          echo "This may indicate:" >&2
          echo "  - WSL mount configuration issue" >&2
          echo "  - Incorrect user directory detection logic" >&2
          echo "  - Race condition in directory availability" >&2
          exit $ERR_USERNAME_DETECTION
        fi
      else
        echo "Not running on WSL, skipping Windows config copy"
      fi
    ''
  );
}
