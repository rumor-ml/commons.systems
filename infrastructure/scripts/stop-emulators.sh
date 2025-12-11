#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators for THIS worktree
# Each worktree has isolated emulators - stopping only affects this worktree

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PID_FILE="/tmp/claude/firebase-emulators-${WORKTREE_HASH}.pid"
LOG_FILE="/tmp/claude/firebase-emulators-${WORKTREE_HASH}.log"

echo "Stopping Firebase emulators for this worktree..."
echo "  Worktree: $(basename "$WORKTREE_ROOT")"
echo "  PID file: $PID_FILE"

if [ ! -f "$PID_FILE" ]; then
  echo "⚠️  No emulator PID file found"
  echo "   Emulators may not be running or were started manually"
  exit 0
fi

EMULATOR_PID=$(cat "$PID_FILE")
echo "Stopping emulator process (PID: ${EMULATOR_PID})..."

if kill "$EMULATOR_PID" 2>/dev/null; then
  echo "✓ Successfully stopped emulator process ${EMULATOR_PID}"
else
  echo "⚠️  Process ${EMULATOR_PID} not found (may have already stopped)"
fi

rm -f "$PID_FILE"
echo "✓ Cleaned up PID file"

if [ -f "$LOG_FILE" ]; then
  rm -f "$LOG_FILE"
  echo "✓ Cleaned up log file"
fi

echo ""
echo "✓ Firebase emulators stopped for this worktree"
echo "  Other worktrees' emulators are still running"
