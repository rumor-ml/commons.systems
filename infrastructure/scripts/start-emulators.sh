#!/usr/bin/env bash
set -euo pipefail

# Start Firebase emulators for Firestore and GCS Storage
# This script starts emulators in the background and waits for them to be ready

# Source port allocation script to get unique ports per worktree
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Use allocated ports from allocate-test-ports.sh
# AUTH_PORT, FIRESTORE_PORT, STORAGE_PORT, UI_PORT are now set
PROJECT_ID="demo-test"
MAX_RETRIES=30
RETRY_INTERVAL=1
PID_FILE="/tmp/claude/firebase-emulators-${AUTH_PORT}.pid"

# Ensure temp directory exists
mkdir -p /tmp/claude

echo "Starting Firebase emulators (Auth on port ${AUTH_PORT}, Firestore on port ${FIRESTORE_PORT}, Storage on port ${STORAGE_PORT})..."

# Check if emulator already running on allocated port
if nc -z localhost $AUTH_PORT 2>/dev/null; then
  echo "✓ Emulators already running on port $AUTH_PORT (shared instance)"
  echo "  Reusing existing emulator instance"
  echo "  Auth: localhost:${AUTH_PORT}"
  echo "  Firestore: localhost:${FIRESTORE_PORT}"
  echo "  Storage: localhost:${STORAGE_PORT}"
  exit 0
fi

# Change to repository root
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

LOG_FILE="/tmp/claude/emulators-${AUTH_PORT}.log"

# Backup original firebase.json
cp firebase.json firebase.json.backup

# Update firebase.json with allocated ports using jq
if command -v jq &> /dev/null; then
  # Use jq for JSON manipulation
  jq ".emulators.auth.port = ${AUTH_PORT} | .emulators.firestore.port = ${FIRESTORE_PORT} | .emulators.storage.port = ${STORAGE_PORT} | .emulators.ui.port = ${UI_PORT}" firebase.json.backup > firebase.json
else
  # Fallback to sed (replace all port values in order)
  sed -e "s/\(\"auth\"[^}]*\"port\":\) [0-9]*/\1 ${AUTH_PORT}/" \
      -e "s/\(\"firestore\"[^}]*\"port\":\) [0-9]*/\1 ${FIRESTORE_PORT}/" \
      -e "s/\(\"storage\"[^}]*\"port\":\) [0-9]*/\1 ${STORAGE_PORT}/" \
      -e "s/\(\"ui\"[^}]*\"port\":\) [0-9]*/\1 ${UI_PORT}/" firebase.json.backup > firebase.json
fi

echo "Updated firebase.json with dynamic ports"

# Start emulators in the background with dynamic ports
firebase emulators:start --only auth,firestore,storage --project="${PROJECT_ID}" > "$LOG_FILE" 2>&1 &
EMULATOR_PID=$!

# Save PID for cleanup
echo "$EMULATOR_PID" > "$PID_FILE"

echo "Firebase emulators started with PID: ${EMULATOR_PID}"
echo "Log file: $LOG_FILE"

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

echo ""
echo "Firebase emulators are ready!"
echo "Environment variables (already exported by allocate-test-ports.sh):"
echo "  FIREBASE_AUTH_EMULATOR_HOST=localhost:${AUTH_PORT}"
echo "  FIRESTORE_EMULATOR_HOST=localhost:${FIRESTORE_PORT}"
echo "  STORAGE_EMULATOR_HOST=localhost:${STORAGE_PORT}"
echo "  FIREBASE_AUTH_PORT=${AUTH_PORT}"
echo "  FIREBASE_FIRESTORE_PORT=${FIRESTORE_PORT}"
echo "  FIREBASE_STORAGE_PORT=${STORAGE_PORT}"
echo "  FIREBASE_UI_PORT=${UI_PORT}"
echo ""
echo "To stop the emulators, run: infrastructure/scripts/stop-emulators.sh"
