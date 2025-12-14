#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators for THIS worktree
# Each worktree has isolated emulators - stopping only affects this worktree

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Use WORKTREE_TMP_DIR from allocate-test-ports.sh
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
PID_FILE="${WORKTREE_TMP_DIR}/firebase-emulators.pid"
LOG_FILE="${WORKTREE_TMP_DIR}/firebase-emulators.log"
TEMP_FIREBASE_JSON="${WORKTREE_TMP_DIR}/firebase.json"

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

if [ -f "$TEMP_FIREBASE_JSON" ]; then
  rm -f "$TEMP_FIREBASE_JSON"
  echo "✓ Cleaned up temporary Firebase config"
fi

echo ""
echo "✓ Firebase emulators stopped for this worktree"
echo "  Other worktrees' emulators are still running"
