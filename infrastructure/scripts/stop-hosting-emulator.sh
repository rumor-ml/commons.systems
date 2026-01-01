#!/usr/bin/env bash
set -euo pipefail

# Stop per-worktree hosting emulator only
# Keeps shared backend emulators running (other worktrees may use them)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source port utilities for process management
source "${SCRIPT_DIR}/port-utils.sh"

# Source port allocation to get PROJECT_ID and HOSTING_PORT
source "${SCRIPT_DIR}/allocate-test-ports.sh"

echo "Stopping hosting emulator for this worktree..."
echo "  Port: ${HOSTING_PORT}"
echo "  Project: ${PROJECT_ID}"
echo ""

# Kill hosting emulator process group using PID file
HOSTING_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"

if [ -f "$HOSTING_PID_FILE" ]; then
  # Use port-utils.sh functions for PID file parsing and process killing
  if parse_pid_file "$HOSTING_PID_FILE"; then
    kill_process_group "$PARSED_PID" "$PARSED_PGID"
    echo "✓ Killed hosting emulator"
  else
    echo "WARNING: PID file exists but could not be parsed" >&2
    echo "Attempting port-based cleanup as fallback" >&2
  fi

  rm -f "$HOSTING_PID_FILE"
else
  echo "ℹ No PID file found"
fi

# Also cleanup by port (fallback)
PIDS=$(lsof -ti :${HOSTING_PORT} 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -9 2>/dev/null || {
    echo "WARNING: Failed to kill some processes on port ${HOSTING_PORT}" >&2
  }
  echo "✓ Killed processes on port ${HOSTING_PORT}"
else
  echo "ℹ No processes running on port ${HOSTING_PORT}"
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
