#!/usr/bin/env bash
set -euo pipefail

# Kill processes on allocated ports for current worktree

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Fix: Hash the full path (not just name) to match allocate-test-ports.sh
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PORT_OFFSET=$(($HASH % 100))

# Calculate per-worktree ports
APP_PORT=$((8080 + ($PORT_OFFSET * 10)))
HOSTING_PORT=$((5000 + ($PORT_OFFSET * 10)))
PROJECT_ID="demo-test-${HASH}"

echo "Cleaning up test processes for worktree: ${WORKTREE_NAME}"
echo "  App port: ${APP_PORT}"
echo "  Hosting port: ${HOSTING_PORT}"
echo "  Project ID: ${PROJECT_ID}"
echo ""

# Kill app server processes
if lsof -ti :${APP_PORT} >/dev/null 2>&1; then
  lsof -ti :${APP_PORT} | xargs kill -9
  echo "✓ Killed app server processes on port ${APP_PORT}"
else
  echo "ℹ No app server running on port ${APP_PORT}"
fi

# Kill hosting emulator process group
HOSTING_PID_FILE="${WORKTREE_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"
if [ -f "$HOSTING_PID_FILE" ]; then
  # Read PID:PGID format from file
  IFS=':' read -r pid pgid < "$HOSTING_PID_FILE" 2>/dev/null || true

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
fi

# Also cleanup by port (fallback safety net)
if lsof -ti :${HOSTING_PORT} >/dev/null 2>&1; then
  lsof -ti :${HOSTING_PORT} | xargs kill -9
  echo "✓ Killed remaining processes on port ${HOSTING_PORT}"
fi

# Clean up hosting emulator temp config
TEMP_CONFIG="${WORKTREE_ROOT}/tmp/firebase.${PROJECT_ID}.json"
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
