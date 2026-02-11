#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators (backend and hosting)
# Features:
# - Per-worktree hosting emulator shutdown
# - Worktree unregistration from registry
# - Pool instance release (if using pool mode)
# - Safe backend shutdown (refuses shutdown if other worktrees are active, unless --force-backend)
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
TEMP_BACKEND_CONFIG="${SHARED_EMULATOR_DIR}/firebase-backend-*.json"  # Glob pattern

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
    echo "PID file path: $HOSTING_PID_FILE" >&2
    echo "PID file contents:" >&2
    cat "$HOSTING_PID_FILE" 2>/dev/null | sed 's/^/  /' >&2 || echo "  (unable to read file)" >&2
    echo "" >&2
    echo "Expected format: PID:PGID or PID:" >&2
    echo "" >&2
    echo "Attempting port-based cleanup..." >&2

    # Try to find and kill process using the hosting port
    if [ -n "${HOSTING_PORT:-}" ]; then
      HOSTING_PID=$(lsof -ti :${HOSTING_PORT} 2>/dev/null || true)
      if [ -n "$HOSTING_PID" ]; then
        echo "Found process $HOSTING_PID on port $HOSTING_PORT" >&2
        kill -TERM "$HOSTING_PID" 2>/dev/null || true
        sleep 1
        kill -KILL "$HOSTING_PID" 2>/dev/null || true
        echo "✓ Stopped process via port-based cleanup" >&2
      else
        echo "No process found on port $HOSTING_PORT" >&2
      fi
    else
      echo "HOSTING_PORT not set, scanning common port range for emulator processes..." >&2

      # Scan 5000-5999 for Firebase hosting emulators
      FOUND_PORTS=$(lsof -i :5000-5999 2>/dev/null | grep firebase | awk '{print $9}' | cut -d: -f2 | sort -u || true)

      if [ -n "$FOUND_PORTS" ]; then
        echo "Found Firebase processes on ports: $FOUND_PORTS" >&2
        for PORT in $FOUND_PORTS; do
          PID=$(lsof -ti :$PORT 2>/dev/null | head -1 || true)
          if [ -n "$PID" ]; then
            echo "Killing process $PID on port $PORT" >&2
            kill -TERM "$PID" 2>/dev/null || true
            sleep 1
            kill -KILL "$PID" 2>/dev/null || true
          fi
        done
        echo "✓ Stopped emulator processes via port scan" >&2
      else
        echo "No Firebase processes found on ports 5000-5999" >&2
        echo "" >&2
        echo "To manually find and kill orphaned emulator processes:" >&2
        echo "  1. Find Firebase processes: ps aux | grep firebase" >&2
        echo "  2. Find hosting emulator by port: lsof -i :5000-5999 | grep firebase" >&2
        echo "  3. Kill by PID: kill -TERM <pid>" >&2
        echo "  4. Force kill if needed: kill -KILL <pid>" >&2
        echo "" >&2
        echo "Or use stop-emulators.sh --force-backend to kill all emulators" >&2
      fi
    fi
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

    # Clean up shared rules directory
    if [ -d "${SHARED_EMULATOR_DIR}/rules" ]; then
      rm -rf "${SHARED_EMULATOR_DIR}/rules"
      echo "✓ Cleaned up shared rules directory"
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
