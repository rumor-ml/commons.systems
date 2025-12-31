#!/usr/bin/env bash
set -euo pipefail

# Kill processes on allocated ports for current worktree

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Source port utilities for process management
source "${SCRIPT_DIR}/port-utils.sh"

# Fix: Hash the full path (not just name) to match allocate-test-ports.sh
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PORT_OFFSET=$(($HASH % 100))

# Calculate expected per-worktree ports for cleanup
# Note: HOSTING_PORT may differ from allocated port due to find_available_port fallback
# Cleanup strategy: Try PID file first (accurate), fall back to port-based (best effort)
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
  SUCCESS_COUNT=0
  FAIL_COUNT=0
  FAILED_PIDS=""

  for pid in $PIDS; do
    if kill -9 "$pid" 2>/dev/null; then
      ((SUCCESS_COUNT++))
    else
      ((FAIL_COUNT++))
      FAILED_PIDS="$FAILED_PIDS $pid"
      # Get process info for debugging
      PROC_INFO=$(ps -p "$pid" -o user,command 2>&1 || echo "process info unavailable")
      echo "  Failed to kill PID $pid on port ${APP_PORT}: $PROC_INFO" >&2
    fi
  done

  if [ $SUCCESS_COUNT -gt 0 ]; then
    echo "✓ Killed $SUCCESS_COUNT app server process(es) on port ${APP_PORT}"
  fi

  if [ $FAIL_COUNT -gt 0 ]; then
    echo "WARNING: Failed to kill $FAIL_COUNT process(es) on port ${APP_PORT}" >&2
    echo "  PIDs:$FAILED_PIDS" >&2
    echo "  You may need to kill them manually with: sudo kill -9$FAILED_PIDS" >&2
  fi
else
  echo "ℹ No app server running on port ${APP_PORT}"
fi

# Kill hosting emulator process group
HOSTING_PID_FILE="${WORKTREE_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"
if [ -f "$HOSTING_PID_FILE" ]; then
  # Use port-utils.sh functions for PID file parsing and process killing
  if parse_pid_file "$HOSTING_PID_FILE"; then
    kill_process_group "$PARSED_PID" "$PARSED_PGID"
    echo "✓ Killed hosting emulator"
  else
    echo "ERROR: Failed to parse PID file at ${HOSTING_PID_FILE}" >&2
    echo "Falling back to port-based cleanup (may miss child processes)" >&2
  fi

  rm -f "$HOSTING_PID_FILE"
  echo "✓ Removed hosting PID file"
else
  echo "ℹ No hosting PID file found"
fi

# Also cleanup by port (fallback safety net)
PIDS=$(lsof -ti :${HOSTING_PORT} 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  SUCCESS_COUNT=0
  FAIL_COUNT=0
  FAILED_PIDS=""

  for pid in $PIDS; do
    if kill -9 "$pid" 2>/dev/null; then
      ((SUCCESS_COUNT++))
    else
      ((FAIL_COUNT++))
      FAILED_PIDS="$FAILED_PIDS $pid"
      # Get process info for debugging
      PROC_INFO=$(ps -p "$pid" -o user,command 2>&1 || echo "process info unavailable")
      echo "  Failed to kill PID $pid on port ${HOSTING_PORT}: $PROC_INFO" >&2
    fi
  done

  if [ $SUCCESS_COUNT -gt 0 ]; then
    echo "✓ Killed $SUCCESS_COUNT remaining process(es) on port ${HOSTING_PORT}"
  fi

  if [ $FAIL_COUNT -gt 0 ]; then
    echo "WARNING: Failed to kill $FAIL_COUNT process(es) on port ${HOSTING_PORT}" >&2
    echo "  PIDs:$FAILED_PIDS" >&2
    echo "  You may need to kill them manually with: sudo kill -9$FAILED_PIDS" >&2
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
