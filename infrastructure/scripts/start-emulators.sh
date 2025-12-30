#!/usr/bin/env bash
set -euo pipefail

# Start Firebase emulators for Firestore and GCS Storage
# Each worktree runs ISOLATED emulators with unique ports for concurrent testing

# Source port allocation script to get shared ports
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Emulators use worktree-specific ports (set by allocate-test-ports.sh)
PROJECT_ID="demo-test"
MAX_RETRIES=60  # Increased for initial jar downloads
RETRY_INTERVAL=1

# Worktree-specific PID and log files (use WORKTREE_TMP_DIR from allocate-test-ports.sh)
PID_FILE="${WORKTREE_TMP_DIR}/firebase-emulators.pid"
LOG_FILE="${WORKTREE_TMP_DIR}/firebase-emulators.log"

echo "Firebase Emulators (Worktree-Specific Instance):"
echo "  Auth: localhost:${AUTH_PORT}"
echo "  Firestore: localhost:${FIRESTORE_PORT}"
echo "  Storage: localhost:${STORAGE_PORT}"
echo "  UI: http://localhost:${UI_PORT}"
echo ""

# Check if THIS worktree's emulators are already running
if nc -z 127.0.0.1 $AUTH_PORT 2>/dev/null; then
  echo "Emulators already running for this worktree - reusing instance"
  echo "  PID file: $PID_FILE"
  exit 0
fi

echo "Starting new emulator instance for this worktree..."

# Change to repository root
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Generate temporary firebase.json with worktree-specific ports using jq
# NOTE: Keep paths relative - Firebase will resolve them from the repo root where we run the command
# TODO(#366): Move temporary firebase config to /tmp/claude/ instead of repo root
TEMP_FIREBASE_JSON="${REPO_ROOT}/firebase.${WORKTREE_HASH}.json"
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
# Run from repo root so relative paths in firebase.json work correctly
# Use pnpm exec to run firebase-tools from workspace dependencies
cd "${REPO_ROOT}"
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

# Health check function for emulator ports
wait_for_emulator() {
  local name="$1"
  local port="$2"
  local retry_count=0

  echo "Waiting for ${name} emulator on port ${port}..."
  while ! nc -z 127.0.0.1 ${port} 2>/dev/null; do
    retry_count=$((retry_count + 1))
    if [ $retry_count -ge $MAX_RETRIES ]; then
      echo "ERROR: ${name} emulator failed to start after ${MAX_RETRIES} seconds"
      echo "  Port: ${port}"
      echo "  PID: ${EMULATOR_PID}"
      echo ""
      echo "=== EMULATOR STARTUP LOG (last 40 lines) ==="
      tail -n 40 "$LOG_FILE"
      echo ""
      echo "=== CHECKING FOR COMMON ERROR PATTERNS ==="

      # Check for specific failure patterns
      if grep -q "EADDRINUSE" "$LOG_FILE"; then
        echo "❌ CAUSE: Port ${port} is already in use"
        echo "   Action: Run 'lsof -ti :${port}' to find the conflicting process"
      elif grep -q "Cannot find module" "$LOG_FILE"; then
        echo "❌ CAUSE: Missing Node.js dependencies"
        echo "   Action: Run 'pnpm install' in the repository root"
      elif grep -q -i "java" "$LOG_FILE" 2>/dev/null; then
        echo "❌ CAUSE: Java/JAR download or execution failure"
        echo "   Action: Check Java installation with 'java -version'"
      elif grep -q "SIGTERM" "$LOG_FILE"; then
        echo "❌ CAUSE: Emulator received shutdown signal during startup"
        echo "   Action: Check if another emulator failed (see log above)"
      fi

      echo ""
      echo "Full log file: $LOG_FILE"
      echo ""

      kill $EMULATOR_PID 2>/dev/null || true
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep $RETRY_INTERVAL
  done
  echo "${name} emulator is ready on port ${port}"
}

# Wait for all emulators to be ready
wait_for_emulator "Auth" "$AUTH_PORT"
wait_for_emulator "Firestore" "$FIRESTORE_PORT"
wait_for_emulator "Storage" "$STORAGE_PORT"

# Verify emulators are actually serving requests (not just bound to ports)
echo ""
echo "Verifying emulator HTTP endpoints..."

# Wait a moment for services to fully initialize after port binding
sleep 3

# Check Auth emulator REST API
if curl -sf "http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/demo-test/accounts" > /dev/null 2>&1; then
  echo "✓ Auth emulator HTTP API is responding"
else
  echo "⚠️  WARNING: Auth emulator port is open but not responding to HTTP requests"
  echo "   This may indicate the emulator crashed during startup"
  echo ""
  echo "=== Last 30 lines of emulator log ==="
  tail -n 30 "$LOG_FILE"
  echo ""
  echo "Full log: $LOG_FILE"
fi

# Check Firestore emulator
# TODO(#1046): HTTP health checks only log warnings - should fail script or retry
if curl -sf "http://127.0.0.1:${FIRESTORE_PORT}/" > /dev/null 2>&1; then
  echo "✓ Firestore emulator HTTP API is responding"
else
  echo "⚠️  WARNING: Firestore emulator port is open but not responding to HTTP requests"
fi

# Check Storage emulator
if curl -sf "http://127.0.0.1:${STORAGE_PORT}/" > /dev/null 2>&1; then
  echo "✓ Storage emulator HTTP API is responding"
else
  echo "⚠️  WARNING: Storage emulator port is open but not responding to HTTP requests"
fi

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
