# Shell Helper Functions
#
# Shared shell script snippets used across Home Manager shell modules.
# This module provides reusable shell code to eliminate duplication.

{ lib, ... }:

{
  # Session variable sourcing script with robust error handling.
  #
  # This script handles both verbose failures (with stderr output) and silent
  # failures (exit code without output). It uses a temporary file to capture
  # all error output reliably.
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

      # Test source in subshell first to catch 'exit' commands
      # This prevents 'exit' in the script from terminating our shell
      if ! (. "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh") 2>"$error_file"; then
        source_error=$(cat "$error_file" 2>&1)
        rm -f "$error_file" 2>/dev/null
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

      # Source succeeded in subshell, now source in current shell to get exports
      . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" 2>"$error_file"
      rm -f "$error_file" 2>/dev/null
    fi
  '';
}
