#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators for this worktree
# Each worktree runs isolated emulators with unique ports

# Source port allocation script to get worktree-specific paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Worktree-specific PID and log files (use WORKTREE_TMP_DIR from allocate-test-ports.sh)
PID_FILE="${WORKTREE_TMP_DIR}/firebase-emulators.pid"
LOG_FILE="${WORKTREE_TMP_DIR}/firebase-emulators.log"
TEMP_FIREBASE_JSON="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}/firebase.${WORKTREE_HASH}.json"

echo "Stopping Firebase emulators for this worktree..."
echo "  PID file: $PID_FILE"

if [ ! -f "$PID_FILE" ]; then
  echo "No emulator PID file found"
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

# Clean up temporary firebase config
if [ -f "$TEMP_FIREBASE_JSON" ]; then
  rm -f "$TEMP_FIREBASE_JSON"
  echo "✓ Cleaned up temporary firebase config"
fi

echo ""
echo "✓ Firebase emulators stopped successfully"
