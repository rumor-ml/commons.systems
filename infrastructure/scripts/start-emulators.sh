#!/usr/bin/env bash
set -euo pipefail

# Start Firebase emulators for Firestore and GCS Storage
# Emulators are SHARED across all worktrees for efficient resource usage

# Source port allocation script to get shared ports
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Emulators use shared default ports (set by allocate-test-ports.sh)
PROJECT_ID="demo-test"
MAX_RETRIES=30
RETRY_INTERVAL=1
SHARED_PID_FILE="/tmp/claude/firebase-emulators.pid"  # Shared PID file
SHARED_LOG_FILE="/tmp/claude/firebase-emulators.log"  # Shared log file

# Ensure temp directory exists
mkdir -p /tmp/claude

echo "Firebase Emulators (Shared Instance):"
echo "  Auth: localhost:${AUTH_PORT}"
echo "  Firestore: localhost:${FIRESTORE_PORT}"
echo "  Storage: localhost:${STORAGE_PORT}"
echo "  UI: http://localhost:${UI_PORT}"
echo ""

# Check if emulators are already running (shared across worktrees)
if nc -z localhost $AUTH_PORT 2>/dev/null; then
  echo "✓ Emulators already running - reusing shared instance"
  echo "  Multiple worktrees can connect to the same emulator"
  echo "  Environment variables are already set"
  exit 0
fi

echo "Starting new emulator instance..."

# Change to repository root
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Start emulators in the background (using default ports from firebase.json)
firebase emulators:start --only auth,firestore,storage --project="${PROJECT_ID}" > "$SHARED_LOG_FILE" 2>&1 &
EMULATOR_PID=$!

# Save PID for cleanup (shared across worktrees)
echo "$EMULATOR_PID" > "$SHARED_PID_FILE"

echo "Firebase emulators started with PID: ${EMULATOR_PID}"
echo "Log file: $SHARED_LOG_FILE"

# Health check for Auth
echo "Waiting for Auth emulator on port ${AUTH_PORT}..."
RETRY_COUNT=0
while ! nc -z localhost ${AUTH_PORT} 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "ERROR: Auth emulator failed to start after ${MAX_RETRIES} seconds"
    echo "Last 20 lines of emulator log:"
    tail -n 20 "$SHARED_LOG_FILE"
    kill $EMULATOR_PID 2>/dev/null || true
    rm -f "$SHARED_PID_FILE"
    exit 1
  fi
  sleep $RETRY_INTERVAL
done
echo "Auth emulator is ready on port ${AUTH_PORT}"

# Health check for Firestore
echo "Waiting for Firestore emulator on port ${FIRESTORE_PORT}..."
RETRY_COUNT=0
while ! nc -z localhost ${FIRESTORE_PORT} 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "ERROR: Firestore emulator failed to start after ${MAX_RETRIES} seconds"
    echo "Last 20 lines of emulator log:"
    tail -n 20 "$SHARED_LOG_FILE"
    kill $EMULATOR_PID 2>/dev/null || true
    rm -f "$SHARED_PID_FILE"
    exit 1
  fi
  sleep $RETRY_INTERVAL
done
echo "Firestore emulator is ready on port ${FIRESTORE_PORT}"

# Health check for Storage
echo "Waiting for Storage emulator on port ${STORAGE_PORT}..."
RETRY_COUNT=0
while ! nc -z localhost ${STORAGE_PORT} 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "ERROR: Storage emulator failed to start after ${MAX_RETRIES} seconds"
    echo "Last 20 lines of emulator log:"
    tail -n 20 "$SHARED_LOG_FILE"
    kill $EMULATOR_PID 2>/dev/null || true
    rm -f "$SHARED_PID_FILE"
    exit 1
  fi
  sleep $RETRY_INTERVAL
done
echo "Storage emulator is ready on port ${STORAGE_PORT}"

echo ""
echo "✓ Firebase emulators are ready!"
echo ""
echo "Shared instance accessible from all worktrees:"
echo "  FIREBASE_AUTH_EMULATOR_HOST=localhost:${AUTH_PORT}"
echo "  FIRESTORE_EMULATOR_HOST=localhost:${FIRESTORE_PORT}"
echo "  STORAGE_EMULATOR_HOST=localhost:${STORAGE_PORT}"
echo "  Emulator UI: http://localhost:${UI_PORT}"
echo ""
echo "⚠️  NOTE: Emulators are shared across worktrees."
echo "   Stopping them will affect all active worktrees."
echo ""
echo "To stop: infrastructure/scripts/stop-emulators.sh"
