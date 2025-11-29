#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators
# This script kills the emulator processes and cleans up temp files

PID_FILE="/tmp/claude/firebase-emulators.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No emulator PID file found at ${PID_FILE}"
  echo "Emulators may not be running or were started manually."
  exit 0
fi

EMULATOR_PID=$(cat "$PID_FILE")

echo "Stopping Firebase emulators (PID: ${EMULATOR_PID})..."

# Kill the emulator process
if kill "$EMULATOR_PID" 2>/dev/null; then
  echo "Successfully stopped emulator process ${EMULATOR_PID}"
else
  echo "Process ${EMULATOR_PID} not found (may have already stopped)"
fi

# Clean up PID file
rm -f "$PID_FILE"
echo "Cleaned up PID file"

# Clean up log file
if [ -f "/tmp/claude/emulators.log" ]; then
  rm -f /tmp/claude/emulators.log
  echo "Cleaned up log file"
fi

echo "Firebase emulators stopped successfully"
