# Source Home Manager session variables with robust error handling
#
# This function handles both verbose failures (with stderr output) and silent
# failures (exit code without output). It uses a temporary file to capture
# all error output reliably.
#
# Returns:
#   0 - Successfully sourced or file doesn't exist
#   1 - Failed to source with error diagnostics printed to stderr
sourceHomeManagerSessionVars() {
  # Check if session vars file exists
  if [ -f "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
    # Create temp file for error capture
    if ! error_file=$(mktemp 2>&1); then
      echo "ERROR: Cannot create temp file to capture error details" >&2
      echo "  mktemp failed: $error_file" >&2
      return 1
    fi

    # Source with error capture
    if ! . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" 2>"$error_file"; then
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
    rm -f "$error_file" 2>/dev/null
  fi
}
