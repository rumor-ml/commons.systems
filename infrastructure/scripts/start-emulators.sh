#!/usr/bin/env bash
set -euo pipefail

# Start Firebase emulators for Firestore and GCS Storage
# Each worktree runs ISOLATED emulators with unique ports for concurrent testing

# Source port allocation script to get shared ports
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Emulators use worktree-specific ports (set by allocate-test-ports.sh)
PROJECT_ID="demo-test"
MAX_RETRIES=60  # Increased for initial jar downloads
RETRY_INTERVAL=1

# Worktree-specific PID and log files
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PID_FILE="/tmp/claude/firebase-emulators-${WORKTREE_HASH}.pid"
LOG_FILE="/tmp/claude/firebase-emulators-${WORKTREE_HASH}.log"

# Ensure temp directory exists
mkdir -p /tmp/claude

echo "Firebase Emulators (Worktree-Specific Instance):"
echo "  Auth: localhost:${AUTH_PORT}"
echo "  Firestore: localhost:${FIRESTORE_PORT}"
echo "  Storage: localhost:${STORAGE_PORT}"
echo "  UI: http://localhost:${UI_PORT}"
echo ""

# Check if THIS worktree's emulators are already running
if nc -z localhost $AUTH_PORT 2>/dev/null; then
  echo "Emulators already running for this worktree - reusing instance"
  echo "  PID file: $PID_FILE"
  exit 0
fi

echo "Starting new emulator instance for this worktree..."

# Change to repository root
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Generate temporary firebase.json with worktree-specific ports using jq
# Keep config in repo root so relative rules paths work correctly
TEMP_FIREBASE_JSON="${REPO_ROOT}/.firebase-${WORKTREE_HASH}.json"
jq --arg auth_port "$AUTH_PORT" \
   --arg firestore_port "$FIRESTORE_PORT" \
   --arg storage_port "$STORAGE_PORT" \
   --arg ui_port "$UI_PORT" \
   '.emulators.auth.port = ($auth_port | tonumber) |
    .emulators.firestore.port = ($firestore_port | tonumber) |
    .emulators.storage.port = ($storage_port | tonumber) |
    .emulators.ui.port = ($ui_port | tonumber)' \
   firebase.json > "$TEMP_FIREBASE_JSON"

# Start emulators using temporary config with unique ports
# Use pnpm exec to run firebase-tools from workspace dependencies
pnpm exec firebase emulators:start \
  --config "$TEMP_FIREBASE_JSON" \
  --only auth,firestore,storage \
  --project="${PROJECT_ID}" \
  > "$LOG_FILE" 2>&1 &
EMULATOR_PID=$!

# Save PID for cleanup (worktree-specific)
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
    tail -n 20 "$LOG_FILE"
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
    tail -n 20 "$LOG_FILE"
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
    tail -n 20 "$LOG_FILE"
    kill $EMULATOR_PID 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep $RETRY_INTERVAL
done
echo "Storage emulator is ready on port ${STORAGE_PORT}"

echo ""
echo "Firebase emulators are ready!"
echo ""
echo "Worktree-specific instance running on:"
echo "  FIREBASE_AUTH_EMULATOR_HOST=localhost:${AUTH_PORT}"
echo "  FIRESTORE_EMULATOR_HOST=localhost:${FIRESTORE_PORT}"
echo "  STORAGE_EMULATOR_HOST=localhost:${STORAGE_PORT}"
echo "  Emulator UI: http://localhost:${UI_PORT}"
echo ""
echo "NOTE: This worktree has isolated emulators."
echo "   Other worktrees run their own emulator instances."
echo ""
echo "To stop: infrastructure/scripts/stop-emulators.sh"
