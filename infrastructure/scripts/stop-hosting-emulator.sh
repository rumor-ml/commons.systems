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
  # PGID enables killing entire process group (firebase emulator + child processes) atomically
  # If PGID unavailable, fallback to single PID cleanup which may leave orphaned children
  pid_file_was_corrupt=false
  if ! IFS=':' read -r pid pgid < "$HOSTING_PID_FILE" 2>/dev/null; then
    echo "WARNING: Failed to read PID file at ${HOSTING_PID_FILE}" >&2
    pid=""
    pgid=""
    pid_file_was_corrupt=true
  fi

  # Validate we got at least some data
  if [ -z "$pid" ] && [ -z "$pgid" ]; then
    echo "WARNING: PID file exists but contains no valid data" >&2
    echo "File contents: $(cat "$HOSTING_PID_FILE" 2>/dev/null || echo 'unreadable')" >&2
    echo "Attempting port-based cleanup as fallback" >&2
    rm -f "$HOSTING_PID_FILE"
    pid_file_was_corrupt=true
  fi

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
  pid_file_was_corrupt=false
fi

# Also cleanup by port (fallback)
PIDS=$(lsof -ti :${HOSTING_PORT} 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  KILLED_COUNT=$(echo "$PIDS" | wc -w | tr -d ' ')

  if ! echo "$PIDS" | xargs kill -9 2>/dev/null; then
    echo "ERROR: Failed to kill some processes on port ${HOSTING_PORT}" >&2
    echo "PIDs that couldn't be killed: $PIDS" >&2
    echo "You may need to kill them manually with elevated permissions" >&2
    exit 1
  fi

  # Verify processes are actually dead
  sleep 0.5
  REMAINING=$(lsof -ti :${HOSTING_PORT} 2>/dev/null || true)
  if [ -n "$REMAINING" ]; then
    echo "ERROR: Processes still running on port ${HOSTING_PORT} after kill attempt" >&2
    echo "Remaining PIDs: $REMAINING" >&2
    exit 1
  fi

  echo "✓ Killed ${KILLED_COUNT} processes on port ${HOSTING_PORT}"
else
  # This is suspicious if PID file existed but was unreadable
  if [ "$pid_file_was_corrupt" = "true" ]; then
    echo "WARNING: PID file was corrupt and no processes found on expected port" >&2
    echo "This may indicate the process is running on a different port due to fallback allocation" >&2
    echo "Check for stray firebase-tools processes: ps aux | grep firebase" >&2
  else
    echo "ℹ No processes running on port ${HOSTING_PORT}"
  fi
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
