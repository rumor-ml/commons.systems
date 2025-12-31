#!/usr/bin/env bash
set -euo pipefail

# Kill processes on allocated ports for current worktree

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Fix: Hash the full path (not just name) to match allocate-test-ports.sh
# Different worktrees with same name must get different port offsets to prevent collisions
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PORT_OFFSET=$(($HASH % 100))

# Calculate expected per-worktree ports (base values, may differ from actual if fallback was used)
# For hosting cleanup: PID file has actual port; these calculated values are only for fallback cleanup
# For app server: calculated port is always correct (no fallback)
# Hosting emulator: Primary cleanup uses PID file; port-based cleanup is fallback safety net
# App server: Port-based cleanup only
APP_PORT=$((8080 + ($PORT_OFFSET * 10)))
HOSTING_PORT=$((5000 + ($PORT_OFFSET * 10)))
PROJECT_ID="demo-test-${HASH}"

echo "Cleaning up test processes for worktree: ${WORKTREE_NAME}"
echo "  App port: ${APP_PORT}"
echo "  Hosting port: ${HOSTING_PORT}"
echo "  Project ID: ${PROJECT_ID}"
echo ""

# Kill app server processes
PIDS=$(lsof -ti :${APP_PORT} 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -9 2>/dev/null || {
    echo "WARNING: Failed to kill some processes on port ${APP_PORT}" >&2
  }
  echo "✓ Killed app server processes on port ${APP_PORT}"
else
  echo "ℹ No app server running on port ${APP_PORT}"
fi

# Kill hosting emulator process group
HOSTING_PID_FILE="${WORKTREE_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"
if [ -f "$HOSTING_PID_FILE" ]; then
  # Parse PID and PGID from file (format: PID:PGID)
  # PGID enables killing entire process group (firebase emulator + child processes) atomically
  # If PGID unavailable, fallback to single PID cleanup which may leave orphaned children
  pid_file_was_corrupt=false
  if ! IFS=':' read -r pid pgid < "$HOSTING_PID_FILE" 2>/dev/null; then
    echo "WARNING: Failed to read PID file at ${HOSTING_PID_FILE}" >&2
    echo "File may be corrupted - attempting port-based cleanup" >&2
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
    # Kill entire process group (parent + children)
    kill -TERM -$pgid 2>/dev/null || true
    sleep 1
    kill -KILL -$pgid 2>/dev/null || true
    echo "✓ Killed hosting emulator process group (PGID: ${pgid})"
  elif [ -n "$pid" ]; then
    # Fallback to single PID if PGID not available
    kill -TERM $pid 2>/dev/null || true
    sleep 1
    kill -KILL $pid 2>/dev/null || true
    echo "✓ Killed hosting emulator (PID: ${pid})"
  fi

  rm -f "$HOSTING_PID_FILE"
  echo "✓ Removed hosting PID file"
else
  echo "ℹ No hosting PID file found"
  pid_file_was_corrupt=false
fi

# Also cleanup by port (fallback safety net)
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
  fi
fi

# Clean up hosting emulator temp config
TEMP_CONFIG="${WORKTREE_ROOT}/.firebase-${PROJECT_ID}.json"
if [ -f "$TEMP_CONFIG" ]; then
  rm -f "$TEMP_CONFIG"
  echo "✓ Removed hosting temp config"
fi

# Also clean up any stale air processes in this worktree
SITE_DIR="${WORKTREE_ROOT}/printsync/site"
if [ -d "$SITE_DIR" ]; then
  pkill -f "air.*${SITE_DIR}" 2>/dev/null || true
  pkill -f "${SITE_DIR}/tmp/main" 2>/dev/null || true
  echo "✓ Cleaned up air processes"
fi

echo "✓ Cleanup complete"
