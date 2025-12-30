#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators (per-worktree)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-emulators.pid"
LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-emulators.log"

if [ ! -f "$PID_FILE" ]; then
  echo "No emulator PID file found at ${PID_FILE}"
  echo "Emulators may not be running or were started manually."
  exit 0
fi

EMULATOR_PID=$(cat "$PID_FILE")

echo "Stopping Firebase emulators (PID: ${EMULATOR_PID})..."

# Kill the emulator process
if kill "$EMULATOR_PID" 2>/dev/null; then
  echo "✓ Successfully stopped emulator process ${EMULATOR_PID}"
else
  echo "⚠️  Process ${EMULATOR_PID} not found (may have already stopped)"
fi

# Clean up PID file
rm -f "$PID_FILE"
echo "✓ Cleaned up PID file"

# Clean up log file
if [ -f "$LOG_FILE" ]; then
  rm -f "$LOG_FILE"
  echo "✓ Cleaned up log file"
fi

echo ""
echo "✓ Firebase emulators stopped successfully"
