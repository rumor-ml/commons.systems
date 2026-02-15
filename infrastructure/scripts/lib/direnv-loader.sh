#!/usr/bin/env bash
# Shared direnv environment loader with auto-recovery
# Usage: source infrastructure/scripts/lib/direnv-loader.sh
#        load_direnv_environment [direnv_path] [verbose]
#
# This helper eliminates duplicate direnv loading patterns across the codebase.
# Resolves TODO(#1765) and TODO(#1768) by providing a single source of truth.

load_direnv_environment() {
  local DIRENV_BIN="${1:-direnv}"
  local VERBOSE="${2:-false}"

  # Must be in repository root with .envrc
  if [ ! -f .envrc ]; then
    echo "ERROR: .envrc not found in $(pwd)" >&2
    return 1
  fi

  # Verbose output
  if [ "$VERBOSE" = "true" ]; then
    echo "Loading direnv environment..." >&2
    echo "  Working directory: $(pwd)" >&2
    echo "  direnv binary: $DIRENV_BIN" >&2
    local DIRENV_VERSION=$($DIRENV_BIN version 2>/dev/null || echo "unknown")
    echo "  direnv version: $DIRENV_VERSION" >&2
  fi

  # Helper: try recovery
  try_recovery() {
    local method="$1"
    [ "$VERBOSE" = "true" ] && echo "  → Recovery attempt: $method" >&2

    case "$method" in
      allow)
        $DIRENV_BIN allow . >/dev/null 2>&1
        # Wait briefly for cache to build (direnv runs async)
        sleep 1
        ;;
      clear-cache)
        rm -rf .direnv && $DIRENV_BIN allow . >/dev/null 2>&1
        # Wait briefly for cache rebuild (direnv runs async)
        sleep 1
        ;;
    esac

    # Try export again with retries (cache might still be building)
    # Note: Capture only stdout for eval, stderr contains diagnostic messages
    local max_attempts=5
    local attempt=1
    while [ $attempt -le $max_attempts ]; do
      DIRENV_OUTPUT=$($DIRENV_BIN export bash 2>/dev/null)
      local exit_code=$?

      if [ $exit_code -eq 0 ] && [ -n "$DIRENV_OUTPUT" ]; then
        [ "$VERBOSE" = "true" ] && echo "    ✓ Recovery successful" >&2
        return 0
      fi

      # If not last attempt, wait and retry
      if [ $attempt -lt $max_attempts ]; then
        [ "$VERBOSE" = "true" ] && echo "    Waiting for cache build (attempt $attempt/$max_attempts)..." >&2
        sleep 2
      fi

      attempt=$((attempt + 1))
    done

    return 1
  }

  # Attempt 1: Direct export
  # Note: Capture only stdout for eval, stderr contains diagnostic messages
  DIRENV_OUTPUT=$($DIRENV_BIN export bash 2>/dev/null)
  local DIRENV_EXIT=$?

  # If first attempt succeeded, we're done
  if [ $DIRENV_EXIT -eq 0 ] && [ -n "$DIRENV_OUTPUT" ]; then
    [ "$VERBOSE" = "true" ] && echo "  ✓ direnv loaded successfully" >&2
    eval "$DIRENV_OUTPUT"
    return 0
  fi

  # Attempt 2: Try allow if failed
  if try_recovery "allow"; then
    [ "$VERBOSE" = "true" ] && echo "  ✓ direnv loaded (recovered with 'direnv allow')" >&2
    eval "$DIRENV_OUTPUT"
    return 0
  fi

  # Attempt 3: Try cache clear if still failed
  if try_recovery "clear-cache"; then
    [ "$VERBOSE" = "true" ] && echo "  ✓ direnv loaded (recovered with cache clear)" >&2
    eval "$DIRENV_OUTPUT"
    return 0
  fi

  # All attempts failed - show diagnostics
  # Capture stderr for diagnostic output
  local DIRENV_ERROR=$($DIRENV_BIN export bash 2>&1 >/dev/null)

  echo "" >&2
  echo "======================================================" >&2
  echo "ERROR: direnv setup failed after auto-recovery" >&2
  echo "======================================================" >&2
  echo "Exit code: $DIRENV_EXIT" >&2
  echo "" >&2
  echo "Diagnostic Information:" >&2
  echo "  - Working directory: $(pwd)" >&2
  echo "  - .envrc modified: $(stat -c '%y' .envrc 2>/dev/null || stat -f '%Sm' .envrc 2>/dev/null)" >&2

  if [ -d .direnv ]; then
    local CACHE_SIZE=$(du -sh .direnv 2>/dev/null | cut -f1)
    echo "  - direnv cache size: $CACHE_SIZE" >&2
  else
    echo "  - direnv cache: MISSING" >&2
  fi

  if [ -n "$DIRENV_ERROR" ]; then
    echo "" >&2
    echo "direnv error output:" >&2
    echo "$DIRENV_ERROR" >&2
  fi

  echo "" >&2
  echo "Common Fixes:" >&2
  echo "  1. Stale cache:      rm -rf .direnv && direnv allow" >&2
  echo "  2. Cache building:   Wait ~10s for cache rebuild, then retry" >&2
  echo "  3. Missing allow:    direnv allow" >&2
  echo "  4. Disk full:        df -h ." >&2
  echo "" >&2
  echo "Note: Git hooks run in subprocesses without shell integration." >&2
  echo "This means direnv must rebuild its cache if .envrc or flake.lock changed." >&2
  return 1
}
