#!/usr/bin/env bash
set -euo pipefail

# Stop development server for THIS worktree
# Each worktree has isolated dev servers - stopping only affects this worktree
#
# Usage:
#   ./stop-dev-server.sh [--with-emulators]
#
# Examples:
#   ./stop-dev-server.sh
#   ./stop-dev-server.sh --with-emulators

# Parse arguments
WITH_EMULATORS=false

if [ $# -gt 0 ] && [ "$1" = "--with-emulators" ]; then
  WITH_EMULATORS=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Use WORKTREE_TMP_DIR from allocate-test-ports.sh
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
PID_FILE="${WORKTREE_TMP_DIR}/dev-server.pid"
LOG_FILE="${WORKTREE_TMP_DIR}/dev-server.log"
MODULE_FILE="${WORKTREE_TMP_DIR}/dev-server.module"

echo "Stopping dev server for this worktree..."
echo "  Worktree: $(basename "$WORKTREE_ROOT")"
echo "  PID file: $PID_FILE"

if [ ! -f "$PID_FILE" ]; then
  echo "⚠️  No dev server PID file found"
  echo "   Dev server may not be running or was started manually"

  if [ "$WITH_EMULATORS" = true ]; then
    echo ""
    echo "Stopping emulators anyway..."
    "${SCRIPT_DIR}/stop-emulators.sh"
  fi

  exit 0
fi

DEV_SERVER_PID=$(cat "$PID_FILE")
MODULE_NAME=$(cat "$MODULE_FILE" 2>/dev/null || echo "unknown")

echo "Stopping dev server process (Module: ${MODULE_NAME}, PID: ${DEV_SERVER_PID})..."

# Try graceful shutdown first (SIGTERM)
if kill -TERM "$DEV_SERVER_PID" 2>/dev/null; then
  echo "Sent SIGTERM to process ${DEV_SERVER_PID}, waiting for graceful shutdown..."

  # Wait up to 10 seconds for graceful shutdown
  WAIT_COUNT=0
  MAX_WAIT=10
  while kill -0 "$DEV_SERVER_PID" 2>/dev/null && [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
  done

  # If still running, force kill
  if kill -0 "$DEV_SERVER_PID" 2>/dev/null; then
    echo "Process did not stop gracefully, sending SIGKILL..."
    kill -KILL "$DEV_SERVER_PID" 2>/dev/null || true
    sleep 1
  fi

  if kill -0 "$DEV_SERVER_PID" 2>/dev/null; then
    echo "⚠️  WARNING: Process ${DEV_SERVER_PID} may still be running"
  else
    echo "✓ Successfully stopped dev server process ${DEV_SERVER_PID}"
  fi
else
  echo "⚠️  Process ${DEV_SERVER_PID} not found (may have already stopped)"
fi

# Clean up PID and module files
rm -f "$PID_FILE"
echo "✓ Cleaned up PID file"

if [ -f "$MODULE_FILE" ]; then
  rm -f "$MODULE_FILE"
  echo "✓ Cleaned up module file"
fi

if [ -f "$LOG_FILE" ]; then
  rm -f "$LOG_FILE"
  echo "✓ Cleaned up log file"
fi

# Stop emulators if requested
if [ "$WITH_EMULATORS" = true ]; then
  echo ""
  echo "Stopping Firebase emulators..."
  "${SCRIPT_DIR}/stop-emulators.sh"
fi

echo ""
echo "✓ Dev server stopped for this worktree"
echo "  Other worktrees' dev servers are still running"
