# Shell Helper Functions
#
# Shared shell script snippets used across Home Manager shell modules.
# This module provides reusable shell code to eliminate duplication.

{ lib, ... }:

{
  # Session variable sourcing script with robust error handling.
  #
  # This script handles both verbose failures (script writes to stderr) and silent
  # failures (script exits non-zero without output). Uses a temp file to capture
  # stderr because command substitution can lose error output in some shells.
  #
  # Why both cases: Some shell initialization scripts fail silently (just 'exit 1')
  # while others write error messages. We need to detect both to provide useful diagnostics.
  #
  # Returns:
  #   Shell script that defines and calls sourceHomeManagerSessionVars function
  #
  # Usage in a module:
  #   let shellHelpers = import ./lib/shell-helpers.nix { inherit lib; };
  #   in {
  #     programs.bash.initExtra = shellHelpers.sessionVarsSourcingScript;
  #   }
  sessionVarsSourcingScript = ''
    # Source Home Manager session variables if not already loaded
    if [ -f "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
      # Create temp file for error capture
      if ! error_file=$(mktemp 2>&1); then
        echo "ERROR: Cannot create temp file to capture error details" >&2
        echo "  mktemp failed: $error_file" >&2
        return 1
      fi

      # Phase 1: Test source in subshell to catch 'exit' commands safely
      # If hm-session-vars.sh contains 'exit', it would close the user's terminal if sourced directly.
      # Subshell test (with parentheses) isolates the exit - only the subshell dies, not the terminal.
      # Note: Subshell test doesn't export variables to parent shell, so we need phase 2.
      if ! (. "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh") 2>"$error_file"; then
        source_error=$(cat "$error_file" 2>&1)
        if ! rm -f "$error_file" 2>&1; then
          echo "WARNING: Failed to cleanup temp file: $error_file" >&2
          echo "  This may indicate filesystem or permission issues" >&2
          echo "  Check /tmp directory health: df -h /tmp; ls -ld /tmp" >&2
        fi
        echo "ERROR: Failed to source Home Manager session variables" >&2
        echo "  File: $HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" >&2
        if [ -n "$source_error" ]; then
          echo "  Error: $source_error" >&2
        else
          echo "  Error: Script exited with failure but produced no output" >&2
          echo "  Try running directly: . \$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" >&2
        fi
        echo "  This may affect environment variables like TZ (timezone)" >&2
        echo "  Shell initialization aborted to prevent misconfiguration" >&2
        return 1
      fi

      # Phase 2: Source in current shell to actually set environment variables
      # CRITICAL: Still check for errors - race conditions or environment differences could cause failure
      # even though subshell test succeeded. This is the actual sourcing that exports variables.
      if ! . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" 2>"$error_file"; then
        main_error=$(cat "$error_file" 2>&1)
        if ! rm -f "$error_file" 2>/dev/null; then
          if [ -z "$_HM_CLEANUP_WARNED" ]; then
            echo "WARNING: Failed to cleanup temp file: $error_file" >&2
            echo "  Check /tmp directory health and permissions" >&2
            export _HM_CLEANUP_WARNED=1
          fi
        fi
        echo "ERROR: Subshell test succeeded but main shell source failed" >&2
        echo "  File: $HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" >&2
        echo "  This indicates a race condition or environment difference" >&2
        if [ -n "$main_error" ]; then
          echo "  Error: $main_error" >&2
        fi
        echo "  Shell initialization aborted to prevent misconfiguration" >&2
        return 1
      fi
      if ! rm -f "$error_file" 2>/dev/null; then
        if [ -z "$_HM_CLEANUP_WARNED" ]; then
          echo "WARNING: Failed to cleanup temp file: $error_file" >&2
          echo "  Check /tmp directory health and permissions" >&2
          export _HM_CLEANUP_WARNED=1
        fi
      fi
    fi
  '';
}
