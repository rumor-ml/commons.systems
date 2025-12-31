#!/usr/bin/env bash
set -euo pipefail

# Stop per-worktree hosting emulator only
# Keeps shared backend emulators running (other worktrees may use them)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source port allocation to get PROJECT_ID and HOSTING_PORT
source "${SCRIPT_DIR}/allocate-test-ports.sh"

echo "Stopping hosting emulator for this worktree..."
echo "  Port: ${HOSTING_PORT}"
echo "  Project: ${PROJECT_ID}"
echo ""

# Kill hosting emulator process group using PID file
HOSTING_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"

if [ -f "$HOSTING_PID_FILE" ]; then
  # Read PID:PGID format from file
  IFS=':' read -r pid pgid < "$HOSTING_PID_FILE" 2>/dev/null || true

  if [ -n "$pgid" ]; then
    # Kill entire process group
    if kill -0 -$pgid 2>/dev/null; then
      kill -TERM -$pgid 2>/dev/null || true
      sleep 1
      kill -KILL -$pgid 2>/dev/null || true
      echo "✓ Killed hosting emulator process group (PGID: ${pgid})"
    else
      echo "ℹ Hosting emulator process group (PGID: ${pgid}) not running"
    fi
  elif [ -n "$pid" ]; then
    # Fallback to single PID
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
      echo "✓ Killed hosting emulator (PID: ${pid})"
    else
      echo "ℹ Hosting emulator process (PID: ${pid}) not running"
    fi
  fi

  rm -f "$HOSTING_PID_FILE"
else
  echo "ℹ No PID file found"
fi

# Also cleanup by port (fallback)
if lsof -ti :${HOSTING_PORT} >/dev/null 2>&1; then
  lsof -ti :${HOSTING_PORT} | xargs kill -9
  echo "✓ Killed processes on port ${HOSTING_PORT}"
fi

# Clean up temp config file
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"
if [ -f "$TEMP_CONFIG" ]; then
  rm -f "$TEMP_CONFIG"
  echo "✓ Removed temp config file"
fi

echo ""
echo "✅ Hosting emulator stopped"
echo ""
echo "Backend emulators (Auth, Firestore, Storage) are still running."
echo "To stop all emulators: infrastructure/scripts/stop-emulators.sh"
echo ""
