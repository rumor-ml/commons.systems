#!/usr/bin/env bash
set -euo pipefail

# Start Firebase emulators with multi-worktree isolation
#
# Architecture:
# - Backend emulators (Auth, Firestore, Storage) are SHARED across worktrees
# - Hosting emulator is PER-WORKTREE (serves worktree-specific build)
# - Project IDs isolate Firestore data per worktree
#
# Why this design?
# - Backend emulators are resource-intensive (Firestore/Auth consume significant memory/CPU),
#   so sharing them across worktrees saves resources
# - Hosting must be per-worktree because it serves from relative paths - each worktree
#   has different build artifacts that must not be contaminated
# - Project IDs provide Firestore data isolation without running multiple backend instances
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
  cd "${PROJECT_ROOT}"

  # Start ONLY backend emulators (shared)
  npx firebase-tools emulators:start \
    --only auth,firestore,storage \
    --project="${PROJECT_ID}" \
    > "$BACKEND_LOG_FILE" 2>&1 &

  BACKEND_PID=$!
  echo "$BACKEND_PID" > "$BACKEND_PID_FILE"

  echo "Backend emulators started with PID: ${BACKEND_PID}"
  echo "Log file: $BACKEND_LOG_FILE"

  # Wait a moment for process to start or fail immediately
  sleep 2

  # Check if process is still running (catches immediate failures)
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "ERROR: Backend emulator process died immediately after start" >&2
    echo "This usually indicates a configuration or startup error" >&2
    echo "Last 50 lines of emulator log:" >&2
    tail -n 50 "$BACKEND_LOG_FILE" >&2
    rm -f "$BACKEND_PID_FILE"
    exit 1
  fi

  # Health check for Auth
  if ! wait_for_port ${AUTH_PORT} "Auth emulator" $MAX_RETRIES "$BACKEND_LOG_FILE" $BACKEND_PID; then
    kill $BACKEND_PID 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE"
    exit 1
  fi

  # Health check for Firestore
  if ! wait_for_port ${FIRESTORE_PORT} "Firestore emulator" $MAX_RETRIES "$BACKEND_LOG_FILE" $BACKEND_PID; then
    kill $BACKEND_PID 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE"
    exit 1
  fi

  # Health check for Storage
  if ! wait_for_port ${STORAGE_PORT} "Storage emulator" $MAX_RETRIES "$BACKEND_LOG_FILE" $BACKEND_PID; then
    kill $BACKEND_PID 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE"
    exit 1
  fi
  echo ""
fi

# ============================================================================
# PHASE 2: Start Per-Worktree Hosting Emulator (ALWAYS start)
# ============================================================================

echo "Starting per-worktree hosting emulator..."
echo "  Port: ${HOSTING_PORT}"
echo "  Project: ${PROJECT_ID}"
echo "  Serving from: Paths configured in firebase.json (relative to this worktree)"

# Validate port availability
# allocate-test-ports.sh should have found an available port
if ! is_port_available ${HOSTING_PORT}; then
  echo "ERROR: Allocated port ${HOSTING_PORT} is not available" >&2
  echo "Port owner:" >&2
  get_port_owner ${HOSTING_PORT} >&2
  echo "" >&2
  echo "Port allocation race condition detected. Try running the script again." >&2
  echo "If this persists, check for processes holding ports in range 5000-5990:" >&2
  echo "  lsof -i :5000-5990" >&2
  exit 1
fi

# Double-check immediately before starting emulator (narrow race window)
sleep 0.1
if ! is_port_available ${HOSTING_PORT}; then
  echo "ERROR: Port ${HOSTING_PORT} became unavailable between check and start" >&2
  echo "This indicates a race condition with another process" >&2
  get_port_owner ${HOSTING_PORT} >&2
  exit 1
fi

# Change to repository root
cd "${PROJECT_ROOT}"

# Create temporary firebase config for this worktree with custom hosting port
# Put it in PROJECT_ROOT so relative paths work correctly
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"

# Filter hosting config to only include the site being tested (if APP_NAME provided)
# Keep paths relative since Firebase is launched from PROJECT_ROOT
# Remove site/target fields - Firebase emulator limitation: doesn't support multi-site
# routing like production Firebase Hosting. Each site needs a separate emulator instance.
if [ -n "$APP_NAME" ]; then
  # Extract the one site config and remove site/target fields
  HOSTING_CONFIG=$(jq --arg site "$APP_NAME" \
    '.hosting[] | select(.site == $site) | del(.site, .target)' \
    firebase.json 2>&1)
  JQ_STATUS=$?

  if [ $JQ_STATUS -ne 0 ]; then
    echo "ERROR: jq failed to extract hosting config for site '$APP_NAME'" >&2
    echo "jq exit status: $JQ_STATUS" >&2
    echo "jq output: $HOSTING_CONFIG" >&2
    echo "" >&2
    echo "This usually indicates:" >&2
    echo "  - firebase.json has syntax errors" >&2
    echo "  - Site '$APP_NAME' doesn't exist in firebase.json" >&2
    echo "  - jq is not installed" >&2
    exit 1
  fi

  if [ -z "$HOSTING_CONFIG" ] || [ "$HOSTING_CONFIG" = "null" ]; then
    echo "ERROR: No hosting config found for site '$APP_NAME' in firebase.json" >&2
    echo "Available sites: $(jq -r '.hosting[].site' firebase.json 2>/dev/null | tr '\n' ', ')" >&2
    exit 1
  fi

  # Validate it's actually valid JSON by attempting to parse it
  if ! echo "$HOSTING_CONFIG" | jq empty 2>/dev/null; then
    echo "ERROR: jq produced invalid JSON output" >&2
    echo "Output: $HOSTING_CONFIG" >&2
    exit 1
  fi

  echo "Hosting only site: $APP_NAME"
else
  # For all sites, keep as array but remove site/target fields
  HOSTING_CONFIG=$(jq '.hosting | map(del(.site, .target))' firebase.json 2>&1)
  JQ_STATUS=$?

  if [ $JQ_STATUS -ne 0 ]; then
    echo "ERROR: jq failed to extract hosting configs from firebase.json" >&2
    echo "jq exit status: $JQ_STATUS" >&2
    echo "jq output: $HOSTING_CONFIG" >&2
    echo "" >&2
    echo "This usually indicates:" >&2
    echo "  - firebase.json has syntax errors" >&2
    echo "  - .hosting array is missing" >&2
    echo "  - jq is not installed" >&2
    exit 1
  fi

  if [ -z "$HOSTING_CONFIG" ] || [ "$HOSTING_CONFIG" = "null" ] || [ "$HOSTING_CONFIG" = "[]" ]; then
    echo "ERROR: No hosting configs found in firebase.json" >&2
    exit 1
  fi

  # Validate it's actually valid JSON by attempting to parse it
  if ! echo "$HOSTING_CONFIG" | jq empty 2>/dev/null; then
    echo "ERROR: jq produced invalid JSON output" >&2
    echo "Output: $HOSTING_CONFIG" >&2
    exit 1
  fi

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
  if parse_pid_file "$HOSTING_PID_FILE"; then
    kill_process_group "$PARSED_PID" "$PARSED_PGID"
  fi
  rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
}

# Only register trap when script is run directly, not sourced.
# When sourced by run-e2e-tests.sh, the parent script's EXIT trap handles cleanup.
# Double-registration would cause cleanup to run twice, potentially killing emulators
# before tests complete.
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

# Extract PGID with error handling and retry
HOSTING_PGID=$(ps -o pgid= -p $HOSTING_PID 2>/dev/null | tr -d ' ')

if [ -z "$HOSTING_PGID" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  echo "⚠️  WARNING: Failed to extract process group ID" >&2
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  echo "" >&2
  echo "This may happen if:" >&2
  echo "  - The emulator process terminated immediately (check logs)" >&2
  echo "  - Platform differences in 'ps' command" >&2
  echo "  - The process hasn't forked yet (rare race condition)" >&2
  echo "" >&2
  echo "Impact: Cleanup may not kill all child processes" >&2
  echo "Workaround: Use port-based cleanup if issues occur" >&2
  echo "" >&2
  echo "PID: ${HOSTING_PID}" >&2
  echo "Log file: ${HOSTING_LOG_FILE}" >&2
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

  # Wait a moment then retry once
  sleep 1
  HOSTING_PGID=$(ps -o pgid= -p $HOSTING_PID 2>/dev/null | tr -d ' ')

  if [ -z "$HOSTING_PGID" ]; then
    echo "⚠️  PGID extraction failed after retry - using PID-only tracking" >&2
    echo "${HOSTING_PID}" > "$HOSTING_PID_FILE"
    echo "Hosting emulator started with PID: ${HOSTING_PID} (PGID unavailable)"
  else
    echo "✓ PGID extraction succeeded on retry: ${HOSTING_PGID}" >&2
    echo "${HOSTING_PID}:${HOSTING_PGID}" > "$HOSTING_PID_FILE"
    echo "Hosting emulator started with PID: ${HOSTING_PID}, PGID: ${HOSTING_PGID}"
  fi
else
  # Success on first try
  echo "${HOSTING_PID}:${HOSTING_PGID}" > "$HOSTING_PID_FILE"
  echo "Hosting emulator started with PID: ${HOSTING_PID}, PGID: ${HOSTING_PGID}"
fi

echo "Log file: $HOSTING_LOG_FILE"

# Wait for hosting to be ready (check the assigned port)
MAX_HOSTING_RETRIES=15  # Hosting starts faster than backend
if ! wait_for_port ${HOSTING_PORT} "Hosting emulator" $MAX_HOSTING_RETRIES "$HOSTING_LOG_FILE" $HOSTING_PID; then
  # Check if port is bound by another process (race condition)
  if ! is_port_available ${HOSTING_PORT}; then
    echo "Port ${HOSTING_PORT} is now in use by another process:" >&2
    get_port_owner ${HOSTING_PORT} >&2
    echo "" >&2
    echo "This indicates a port conflict race condition" >&2
  fi

  kill $HOSTING_PID 2>/dev/null || true
  rm -f "$HOSTING_PID_FILE"
  rm -f "$TEMP_CONFIG"
  exit 1
fi

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
