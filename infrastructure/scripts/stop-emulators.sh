#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators
# This script kills the emulator processes and cleans up temp files

# Source port allocation script to get the correct port for this worktree
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

PID_FILE="/tmp/claude/firebase-emulators-${AUTH_PORT}.pid"
LOG_FILE="/tmp/claude/emulators-${AUTH_PORT}.log"

if [ ! -f "$PID_FILE" ]; then
  echo "No emulator PID file found at ${PID_FILE}"
  echo "Emulators for this worktree may not be running or were started manually."
  exit 0
fi

EMULATOR_PID=$(cat "$PID_FILE")

echo "Stopping Firebase emulators on port ${AUTH_PORT} (PID: ${EMULATOR_PID})..."

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
if [ -f "$LOG_FILE" ]; then
  rm -f "$LOG_FILE"
  echo "Cleaned up log file"
fi

# Restore original firebase.json if backup exists
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FIREBASE_BACKUP="${REPO_ROOT}/firebase.json.backup"
if [ -f "$FIREBASE_BACKUP" ]; then
  mv "$FIREBASE_BACKUP" "${REPO_ROOT}/firebase.json"
  echo "Restored original firebase.json"
fi

echo "Firebase emulators stopped successfully"
