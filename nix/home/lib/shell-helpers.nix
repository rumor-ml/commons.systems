# Shell Helper Functions
#
# Shared shell script snippets used across Home Manager shell modules.
# This module provides reusable shell code to eliminate duplication.

{ lib, ... }:

{
  # Session variable sourcing script with robust error handling.
  #
  # Type: string (bash/zsh script)
  #
  # Invariants:
  #   - Handles missing hm-session-vars.sh gracefully (no error if file not found)
  #   - Aborts shell initialization (return 1) on source failures
  #   - Uses temp file to capture stderr for diagnostics
  #
  # Returns:
  #   Shell script that sources Home Manager session variables with two-phase error handling
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

      # Phase 1: Test source in subshell to detect failures without affecting current shell
      # The subshell isolates failures (command errors, exit/return statements) so they don't
      # affect the parent shell. This prevents partial variable exports from a failing script.
      #
      # Example problem without two-phase:
      #   If hm-session-vars.sh exports VAR1 then fails, current shell gets VAR1 but is in
      #   inconsistent state. User might not notice the failure but will have wrong env vars.
      #
      # Two-phase solution: Test in subshell first (isolated), then source for real only if test passes.
      # Note: Subshell test doesn't export variables to parent shell, so we need phase 2.
      if ! (. "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh") 2>"$error_file"; then
        source_error=$(cat "$error_file" 2>&1)
        # Cleanup failure is non-fatal - we warn but continue to display source error diagnostics
        # After displaying all error information, shell init is aborted (return 1) due to source failure
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
          # Avoid repeated warnings across multiple cleanup attempts in this function
          # (Same flag used in line 53 cleanup path and line 92 cleanup path)
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
        # Avoid repeated warnings across multiple cleanup attempts in this function
        # (Same flag used in line 53 cleanup path and line 76 cleanup path)
        if [ -z "$_HM_CLEANUP_WARNED" ]; then
          echo "WARNING: Failed to cleanup temp file: $error_file" >&2
          echo "  Check /tmp directory health and permissions" >&2
          export _HM_CLEANUP_WARNED=1
        fi
      fi
    fi
  '';
}
