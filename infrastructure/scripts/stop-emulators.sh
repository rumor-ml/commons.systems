#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators (backend and hosting)
# Features:
# - Per-worktree hosting emulator shutdown
# - Worktree unregistration from registry
# - Pool instance release (if using pool mode)
# - Safe backend shutdown (checks if other worktrees are active)
# - Optional --force-backend flag to override safety check

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source port utilities for process management
source "${SCRIPT_DIR}/port-utils.sh"

# Source allocate-test-ports.sh to get PROJECT_ID
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Derive worktree root from project root
# PROJECT_ROOT is already set to the worktree directory by allocate-test-ports.sh
WORKTREE_ROOT="$PROJECT_ROOT"

# Shared directory for backend emulator state (shared across all worktrees)
SHARED_EMULATOR_DIR="${HOME}/.firebase-emulators"

# PID files for backend and hosting emulators
# Backend emulator is SHARED across worktrees - use shared location
BACKEND_PID_FILE="${SHARED_EMULATOR_DIR}/firebase-backend-emulators.pid"

# Hosting emulator is PER-WORKTREE - use worktree-local location
HOSTING_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"

# Log files
BACKEND_LOG_FILE="${SHARED_EMULATOR_DIR}/firebase-backend-emulators.log"
HOSTING_LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.log"

# Temp config files
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"
TEMP_BACKEND_CONFIG="${SHARED_EMULATOR_DIR}/firebase-backend-*.json"

# Parse command line flags
FORCE_BACKEND=false
while [ $# -gt 0 ]; do
  case "$1" in
    --force-backend)
      FORCE_BACKEND=true
      shift
      ;;
    *)
      echo "ERROR: Unknown flag: $1" >&2
      echo "Usage: $0 [--force-backend]" >&2
      exit 1
      ;;
  esac
done

echo "Stopping Firebase emulators..."
echo ""

# ============================================================================
# PHASE 1: Stop Per-Worktree Hosting Emulator
# ============================================================================

# Stop hosting emulator (per-worktree)
if [ -f "$HOSTING_PID_FILE" ]; then
  echo "Stopping hosting emulator..."

  # Use port-utils.sh functions for PID file parsing and process killing
  if parse_pid_file "$HOSTING_PID_FILE"; then
    kill_process_group "$PARSED_PID" "$PARSED_PGID"
    echo "✓ Successfully stopped hosting emulator"
  else
    echo "WARNING: PID file exists but could not be parsed" >&2
    echo "Skipping PID-based cleanup - will attempt port-based cleanup" >&2
  fi

  # Clean up hosting PID file
  rm -f "$HOSTING_PID_FILE"
  echo "✓ Cleaned up hosting PID file"

  # Clean up hosting log file
  if [ -f "$HOSTING_LOG_FILE" ]; then
    rm -f "$HOSTING_LOG_FILE"
    echo "✓ Cleaned up hosting log file"
  fi

  # Clean up temp config
  if [ -f "$TEMP_CONFIG" ]; then
    rm -f "$TEMP_CONFIG"
    echo "✓ Cleaned up temp config"
  fi
  echo ""
else
  echo "No hosting emulator PID file found (may not be running)"
  echo ""
fi

# ============================================================================
# PHASE 2: Unregister Worktree from Registry
# ============================================================================

echo "Unregistering worktree from registry..."
if "${SCRIPT_DIR}/worktree-registry.sh" unregister "$WORKTREE_ROOT"; then
  echo "✓ Worktree unregistered"
else
  echo "WARNING: Failed to unregister worktree" >&2
fi
echo ""

# ============================================================================
# PHASE 3: Release Pool Instance (if applicable)
# ============================================================================

if [ -n "${POOL_INSTANCE_ID:-}" ]; then
  echo "Releasing pool instance: $POOL_INSTANCE_ID"
  if "${SCRIPT_DIR}/emulator-pool.sh" release "$POOL_INSTANCE_ID"; then
    echo "✓ Pool instance released"
  else
    echo "WARNING: Failed to release pool instance" >&2
  fi
  echo ""
fi

# ============================================================================
# PHASE 4: Stop Backend Emulators (shared - only if safe or forced)
# ============================================================================

if [ -f "$BACKEND_PID_FILE" ]; then
  echo "Backend emulators are shared across worktrees."
  echo "PID file: ${BACKEND_PID_FILE}"
  echo ""

  # Check how many active worktrees are using the backend
  ACTIVE_COUNT=$("${SCRIPT_DIR}/worktree-registry.sh" count)

  if [ "$ACTIVE_COUNT" -eq 0 ] || [ "$FORCE_BACKEND" = "true" ]; then
    echo "Stopping backend emulators..."

    # Kill the backend process
    if parse_pid_file "$BACKEND_PID_FILE"; then
      kill_process_group "$PARSED_PID" "$PARSED_PGID"
      echo "✓ Successfully stopped backend emulators"
    else
      echo "WARNING: PID file exists but could not be parsed" >&2
      echo "PID file contents:" >&2
      cat "$BACKEND_PID_FILE" >&2
    fi

    # Clean up backend PID file
    rm -f "$BACKEND_PID_FILE"
    echo "✓ Cleaned up backend PID file"

    # Clean up backend log file
    if [ -f "$BACKEND_LOG_FILE" ]; then
      rm -f "$BACKEND_LOG_FILE"
      echo "✓ Cleaned up backend log file"
    fi

    # Clean up backend temp configs
    if compgen -G "$TEMP_BACKEND_CONFIG" > /dev/null 2>&1; then
      rm -f $TEMP_BACKEND_CONFIG
      echo "✓ Cleaned up backend temp config(s)"
    fi

    if [ "$FORCE_BACKEND" = "true" ] && [ "$ACTIVE_COUNT" -gt 0 ]; then
      echo ""
      echo "WARNING: Stopped backend emulators while $ACTIVE_COUNT worktree(s) may still be using them!" >&2
      echo "This may break tests in those worktrees. Consider using stop-hosting-emulator.sh instead" >&2
      echo "to stop only this worktree's hosting emulator." >&2
    fi
  else
    echo "Backend emulators still in use by $ACTIVE_COUNT other worktree(s) - NOT stopping"
    echo ""
    echo "Options:"
    echo "  1. Stop only this worktree's hosting emulator: infrastructure/scripts/stop-hosting-emulator.sh"
    echo "  2. Force stop backend (may break other worktrees): infrastructure/scripts/stop-emulators.sh --force-backend"
    echo "  3. Stop emulators in other worktrees manually"
  fi

  echo ""
else
  echo "No backend emulator PID file found (may not be running)"
  # Clean up any orphaned backend temp configs
  if compgen -G "$TEMP_BACKEND_CONFIG" > /dev/null 2>&1; then
    rm -f $TEMP_BACKEND_CONFIG
    echo "✓ Cleaned up orphaned backend temp config(s)"
  fi
  echo ""
fi

echo "✓ Emulator shutdown complete"
