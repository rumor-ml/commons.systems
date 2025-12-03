#!/usr/bin/env bash
set -euo pipefail

# Start Firebase emulators for Firestore and GCS Storage
# This script starts emulators in the background and waits for them to be ready

AUTH_PORT=9099
FIRESTORE_PORT=8081
STORAGE_PORT=9199
PROJECT_ID="demo-test"
MAX_RETRIES=30
RETRY_INTERVAL=1
PID_FILE="/tmp/claude/firebase-emulators.pid"

# Ensure temp directory exists
mkdir -p /tmp/claude

echo "Starting Firebase emulators (Auth on port ${AUTH_PORT}, Firestore on port ${FIRESTORE_PORT}, Storage on port ${STORAGE_PORT})..."

# Change to printsync directory to use its firebase.json which has auth emulator config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}/printsync"

# Start emulators in the background
firebase emulators:start --only auth,firestore,storage --project="${PROJECT_ID}" > /tmp/claude/emulators.log 2>&1 &
EMULATOR_PID=$!

# Save PID for cleanup
echo "$EMULATOR_PID" > "$PID_FILE"

echo "Firebase emulators started with PID: ${EMULATOR_PID}"
echo "Log file: /tmp/claude/emulators.log"

# Health check for Auth
echo "Waiting for Auth emulator on port ${AUTH_PORT}..."
RETRY_COUNT=0
while ! nc -z localhost ${AUTH_PORT} 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "ERROR: Auth emulator failed to start after ${MAX_RETRIES} seconds"
    echo "Last 20 lines of emulator log:"
    tail -n 20 /tmp/claude/emulators.log
    kill $EMULATOR_PID 2>/dev/null || true
    rm -f "$PID_FILE"
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
    tail -n 20 /tmp/claude/emulators.log
    kill $EMULATOR_PID 2>/dev/null || true
    rm -f "$PID_FILE"
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
    tail -n 20 /tmp/claude/emulators.log
    kill $EMULATOR_PID 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep $RETRY_INTERVAL
done
echo "Storage emulator is ready on port ${STORAGE_PORT}"

# Export environment variables
export FIREBASE_AUTH_EMULATOR_HOST="localhost:${AUTH_PORT}"
export FIRESTORE_EMULATOR_HOST="localhost:${FIRESTORE_PORT}"
export STORAGE_EMULATOR_HOST="localhost:${STORAGE_PORT}"

echo ""
echo "Firebase emulators are ready!"
echo "Export these environment variables in your shell:"
echo "  export FIREBASE_AUTH_EMULATOR_HOST=localhost:${AUTH_PORT}"
echo "  export FIRESTORE_EMULATOR_HOST=localhost:${FIRESTORE_PORT}"
echo "  export STORAGE_EMULATOR_HOST=localhost:${STORAGE_PORT}"
echo ""
echo "To stop the emulators, run: infrastructure/scripts/stop-emulators.sh"
