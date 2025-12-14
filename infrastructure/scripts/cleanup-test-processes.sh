#!/usr/bin/env bash
set -euo pipefail

# Kill processes on allocated port for current worktree

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
OFFSET=$((($HASH % 100) * 10))
APP_PORT=$((8080 + $OFFSET))

echo "Cleaning up test processes for port ${APP_PORT}..."

# Kill any process on the allocated port
if lsof -ti :${APP_PORT} >/dev/null 2>&1; then
  lsof -ti :${APP_PORT} | xargs kill -9
  echo "✓ Killed processes on port ${APP_PORT}"
else
  echo "ℹ No processes running on port ${APP_PORT}"
fi

# Also clean up any stale air processes in this worktree
SITE_DIR="${WORKTREE_ROOT}/printsync/site"
if [ -d "$SITE_DIR" ]; then
  pkill -f "air.*${SITE_DIR}" 2>/dev/null || true
  pkill -f "${SITE_DIR}/tmp/main" 2>/dev/null || true
  echo "✓ Cleaned up air processes"
fi

echo "✓ Cleanup complete"
