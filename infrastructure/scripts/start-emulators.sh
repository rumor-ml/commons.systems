#!/usr/bin/env bash
set -euo pipefail

# Start Firebase emulators with multi-worktree isolation
#
# Architecture:
# - Backend emulators (Auth, Firestore, Storage) are SHARED across worktrees
# - Hosting emulator is PER-WORKTREE (serves worktree-specific build)
# - Project IDs isolate Firestore data per worktree
#
# Usage: start-emulators.sh [APP_NAME]
#   APP_NAME: Optional app name to host (e.g., fellspiral, videobrowser)
#             If provided, only that site will be hosted

# Accept APP_NAME parameter
APP_NAME="${1:-}"

# Source port allocation script to get ports and project ID
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/port-utils.sh"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Configuration
MAX_RETRIES=30
RETRY_INTERVAL=1

# PID and log files
BACKEND_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-backend-emulators.pid"
BACKEND_LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-backend-emulators.log"
HOSTING_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"
HOSTING_LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.log"

# Ensure temp directory exists
mkdir -p "${PROJECT_ROOT}/tmp/infrastructure"

echo "========================================="
echo "Firebase Emulators - Multi-Worktree Mode"
echo "========================================="
echo ""
echo "Backend emulators (shared across worktrees):"
echo "  Auth: localhost:${AUTH_PORT}"
echo "  Firestore: localhost:${FIRESTORE_PORT}"
echo "  Storage: localhost:${STORAGE_PORT}"
echo "  UI: http://localhost:${UI_PORT}"
echo ""
echo "Per-worktree emulator:"
echo "  Hosting: localhost:${HOSTING_PORT}"
echo "  Project ID: ${PROJECT_ID}"
echo ""

# ============================================================================
# PHASE 1: Start Shared Backend Emulators (if not already running)
# ============================================================================

if nc -z localhost $AUTH_PORT 2>/dev/null; then
  echo "✓ Backend emulators already running - reusing shared instance"
  echo "  Multiple worktrees can connect to the same backend"
else
  echo "Starting shared backend emulators (Auth, Firestore, Storage)..."

  # Change to repository root
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  cd "${REPO_ROOT}"

  # Start ONLY backend emulators (shared)
  npx firebase-tools emulators:start \
    --only auth,firestore,storage \
    --project="${PROJECT_ID}" \
    > "$BACKEND_LOG_FILE" 2>&1 &

  BACKEND_PID=$!
  echo "$BACKEND_PID" > "$BACKEND_PID_FILE"

  echo "Backend emulators started with PID: ${BACKEND_PID}"
  echo "Log file: $BACKEND_LOG_FILE"

  # Health check for Auth
  echo "Waiting for Auth emulator on port ${AUTH_PORT}..."
  RETRY_COUNT=0
  while ! nc -z localhost ${AUTH_PORT} 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
      echo "ERROR: Auth emulator failed to start after ${MAX_RETRIES} seconds"
      echo "Last 20 lines of emulator log:"
      tail -n 20 "$BACKEND_LOG_FILE"
      kill $BACKEND_PID 2>/dev/null || true
      rm -f "$BACKEND_PID_FILE"
      exit 1
    fi
    sleep $RETRY_INTERVAL
  done
  echo "✓ Auth emulator ready on port ${AUTH_PORT}"

  # Health check for Firestore
  echo "Waiting for Firestore emulator on port ${FIRESTORE_PORT}..."
  RETRY_COUNT=0
  while ! nc -z localhost ${FIRESTORE_PORT} 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
      echo "ERROR: Firestore emulator failed to start after ${MAX_RETRIES} seconds"
      echo "Last 20 lines of emulator log:"
      tail -n 20 "$BACKEND_LOG_FILE"
      kill $BACKEND_PID 2>/dev/null || true
      rm -f "$BACKEND_PID_FILE"
      exit 1
    fi
    sleep $RETRY_INTERVAL
  done
  echo "✓ Firestore emulator ready on port ${FIRESTORE_PORT}"

  # Health check for Storage
  echo "Waiting for Storage emulator on port ${STORAGE_PORT}..."
  RETRY_COUNT=0
  while ! nc -z localhost ${STORAGE_PORT} 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
      echo "ERROR: Storage emulator failed to start after ${MAX_RETRIES} seconds"
      echo "Last 20 lines of emulator log:"
      tail -n 20 "$BACKEND_LOG_FILE"
      kill $BACKEND_PID 2>/dev/null || true
      rm -f "$BACKEND_PID_FILE"
      exit 1
    fi
    sleep $RETRY_INTERVAL
  done
  echo "✓ Storage emulator ready on port ${STORAGE_PORT}"
  echo ""
fi

# ============================================================================
# PHASE 2: Start Per-Worktree Hosting Emulator (ALWAYS start)
# ============================================================================

echo "Starting per-worktree hosting emulator..."
echo "  Port: ${HOSTING_PORT}"
echo "  Project: ${PROJECT_ID}"
echo "  Serving from: fellspiral/site/dist (relative to this worktree)"

# Validate port availability
# allocate-test-ports.sh should have found an available port
if ! is_port_available ${HOSTING_PORT}; then
  echo "ERROR: Allocated port ${HOSTING_PORT} is not available" >&2
  echo "Port owner:" >&2
  get_port_owner ${HOSTING_PORT} >&2
  echo "" >&2
  echo "This should not happen - allocate-test-ports.sh should have found an available port" >&2
  echo "If you see this error, there may be a race condition." >&2
  exit 1
fi

# Change to repository root
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Create temporary firebase config for this worktree with custom hosting port
TEMP_CONFIG="${PROJECT_ROOT}/tmp/firebase.${PROJECT_ID}.json"

# Filter hosting config to only include the site being tested (if APP_NAME provided)
if [ -n "$APP_NAME" ]; then
  HOSTING_CONFIG=$(jq --arg site "$APP_NAME" '[.hosting[] | select(.site == $site)]' firebase.json)
  echo "Hosting only site: $APP_NAME"
else
  HOSTING_CONFIG=$(jq '.hosting' firebase.json)
  echo "Hosting all sites from firebase.json"
fi

cat > "${TEMP_CONFIG}" <<EOF
{
  "emulators": {
    "hosting": {
      "port": ${HOSTING_PORT}
    }
  },
  "hosting": ${HOSTING_CONFIG}
}
EOF

# Cleanup function for hosting emulator (process group)
cleanup_hosting_emulator() {
  if [ -f "$HOSTING_PID_FILE" ]; then
    IFS=':' read -r pid pgid < "$HOSTING_PID_FILE" 2>/dev/null || true
    if [ -n "$pgid" ]; then
      # Kill entire process group (parent + children)
      kill -TERM -$pgid 2>/dev/null || true
      sleep 1
      kill -KILL -$pgid 2>/dev/null || true
    elif [ -n "$pid" ]; then
      # Fallback to single PID
      kill -TERM $pid 2>/dev/null || true
      sleep 1
      kill -KILL $pid 2>/dev/null || true
    fi
    rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
  fi
}

# Only register trap when script is run directly, not sourced
# This prevents trap conflicts when sourced by run-e2e-tests.sh
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  trap cleanup_hosting_emulator EXIT ERR
fi

# Start hosting emulator in new process group (for proper cleanup)
set -m  # Enable job control
npx firebase-tools emulators:start \
  --only hosting \
  --project="${PROJECT_ID}" \
  --config "${TEMP_CONFIG}" \
  > "$HOSTING_LOG_FILE" 2>&1 &

HOSTING_PID=$!
HOSTING_PGID=$(ps -o pgid= -p $HOSTING_PID | tr -d ' ')

# Save both PID and PGID for cleanup (format: PID:PGID)
echo "${HOSTING_PID}:${HOSTING_PGID}" > "$HOSTING_PID_FILE"

echo "Hosting emulator started with PID: ${HOSTING_PID}, PGID: ${HOSTING_PGID}"
echo "Log file: $HOSTING_LOG_FILE"

# Wait for hosting to be ready (check the assigned port)
echo "Waiting for hosting emulator on port ${HOSTING_PORT}..."
RETRY_COUNT=0
MAX_HOSTING_RETRIES=15  # Hosting starts faster than backend
while ! nc -z localhost ${HOSTING_PORT} 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_HOSTING_RETRIES ]; then
    echo "ERROR: Hosting emulator failed to start after ${MAX_HOSTING_RETRIES} seconds"
    echo "Last 20 lines of emulator log:"
    tail -n 20 "$HOSTING_LOG_FILE"
    kill $HOSTING_PID 2>/dev/null || true
    rm -f "$HOSTING_PID_FILE"
    rm -f "$TEMP_CONFIG"
    exit 1
  fi
  sleep $RETRY_INTERVAL
done
echo "✓ Hosting emulator ready on port ${HOSTING_PORT}"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "========================================="
echo "✅ All emulators ready!"
echo "========================================="
echo ""
echo "Backend emulators (shared):"
echo "  FIRESTORE_EMULATOR_HOST=localhost:${FIRESTORE_PORT}"
echo "  FIREBASE_AUTH_EMULATOR_HOST=localhost:${AUTH_PORT}"
echo "  STORAGE_EMULATOR_HOST=localhost:${STORAGE_PORT}"
echo "  Emulator UI: http://localhost:${UI_PORT}"
echo ""
echo "Hosting emulator (this worktree):"
echo "  http://localhost:${HOSTING_PORT}"
echo "  Project: ${PROJECT_ID}"
echo ""
echo "To stop this worktree's hosting emulator:"
echo "  infrastructure/scripts/stop-hosting-emulator.sh"
echo ""
echo "To stop ALL emulators:"
echo "  infrastructure/scripts/stop-emulators.sh"
echo ""
