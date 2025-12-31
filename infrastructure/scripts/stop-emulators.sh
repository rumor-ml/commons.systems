#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators (backend and hosting)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source allocate-test-ports.sh to get PROJECT_ID
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# PID files for backend and hosting emulators
BACKEND_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-backend-emulators.pid"
HOSTING_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"

# Log files
BACKEND_LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-backend-emulators.log"
HOSTING_LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.log"

# Temp config file
TEMP_CONFIG="${PROJECT_ROOT}/tmp/firebase.${PROJECT_ID}.json"

echo "Stopping Firebase emulators..."
echo ""

# Stop hosting emulator (per-worktree)
if [ -f "$HOSTING_PID_FILE" ]; then
  echo "Stopping hosting emulator..."

  # Read PID and PGID from file (format: PID:PGID)
  IFS=':' read -r HOSTING_PID HOSTING_PGID < "$HOSTING_PID_FILE" 2>/dev/null || true

  if [ -n "${HOSTING_PGID:-}" ]; then
    # Kill entire process group (parent + children)
    echo "  Killing process group ${HOSTING_PGID}..."
    if kill -TERM -${HOSTING_PGID} 2>/dev/null; then
      echo "✓ Successfully stopped hosting emulator process group ${HOSTING_PGID}"
    else
      echo "⚠️  Process group ${HOSTING_PGID} not found (may have already stopped)"
    fi

    # Give it a moment to shut down gracefully
    sleep 1

    # Force kill if still running
    kill -KILL -${HOSTING_PGID} 2>/dev/null || true
  elif [ -n "${HOSTING_PID:-}" ]; then
    # Fallback to single PID
    echo "  Killing PID ${HOSTING_PID}..."
    if kill -TERM ${HOSTING_PID} 2>/dev/null; then
      echo "✓ Successfully stopped hosting emulator PID ${HOSTING_PID}"
    else
      echo "⚠️  Process ${HOSTING_PID} not found (may have already stopped)"
    fi

    sleep 1
    kill -KILL ${HOSTING_PID} 2>/dev/null || true
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

# Stop backend emulators (shared - only stop if requested)
if [ -f "$BACKEND_PID_FILE" ]; then
  echo "Backend emulators are shared across worktrees."
  echo "PID file: ${BACKEND_PID_FILE}"
  echo ""
  echo "To stop backend emulators (will affect all worktrees):"
  echo "  kill \$(cat ${BACKEND_PID_FILE})"
  echo "  rm -f ${BACKEND_PID_FILE}"
  echo ""
else
  echo "No backend emulator PID file found (may not be running)"
  echo ""
fi

echo "✓ Hosting emulator stopped successfully"
