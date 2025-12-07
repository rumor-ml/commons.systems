#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators
# WARNING: Emulators are SHARED across all worktrees!
# Stopping them will affect all active worktrees.

SHARED_PID_FILE="/tmp/claude/firebase-emulators.pid"
SHARED_LOG_FILE="/tmp/claude/firebase-emulators.log"

echo "⚠️  WARNING: Emulators are shared across all worktrees!"
echo "   Stopping them will affect all active worktrees."
echo ""

if [ ! -f "$SHARED_PID_FILE" ]; then
  echo "No emulator PID file found at ${SHARED_PID_FILE}"
  echo "Emulators may not be running or were started manually."
  exit 0
fi

EMULATOR_PID=$(cat "$SHARED_PID_FILE")

echo "Stopping shared Firebase emulators (PID: ${EMULATOR_PID})..."

# Kill the emulator process
if kill "$EMULATOR_PID" 2>/dev/null; then
  echo "✓ Successfully stopped emulator process ${EMULATOR_PID}"
else
  echo "⚠️  Process ${EMULATOR_PID} not found (may have already stopped)"
fi

# Clean up PID file
rm -f "$SHARED_PID_FILE"
echo "✓ Cleaned up PID file"

# Clean up log file
if [ -f "$SHARED_LOG_FILE" ]; then
  rm -f "$SHARED_LOG_FILE"
  echo "✓ Cleaned up log file"
fi

echo ""
echo "✓ Firebase emulators stopped successfully"
echo "  All worktrees are now disconnected from emulators"
