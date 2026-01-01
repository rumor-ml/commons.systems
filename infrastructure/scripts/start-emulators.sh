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
#   SKIP_HOSTING: Set to 1 to skip hosting emulator (backend only)

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

if nc -z 127.0.0.1 $AUTH_PORT 2>/dev/null; then
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

  # Health check for Auth
  wait_for_port ${AUTH_PORT} "Auth emulator" ${MAX_RETRIES} "$BACKEND_LOG_FILE" $BACKEND_PID || {
    kill $BACKEND_PID 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE"
    exit 1
  }

  # Health check for Firestore
  wait_for_port ${FIRESTORE_PORT} "Firestore emulator" ${MAX_RETRIES} "$BACKEND_LOG_FILE" $BACKEND_PID || {
    kill $BACKEND_PID 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE"
    exit 1
  }

  # Health check for Storage
  wait_for_port ${STORAGE_PORT} "Storage emulator" ${MAX_RETRIES} "$BACKEND_LOG_FILE" $BACKEND_PID || {
    kill $BACKEND_PID 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE"
    exit 1
  }
  echo ""
fi

# ============================================================================
# PHASE 2: Start Per-Worktree Hosting Emulator (ALWAYS start unless SKIP_HOSTING=1)
# ============================================================================

if [ "${SKIP_HOSTING:-0}" = "1" ]; then
  echo ""
  echo "========================================="
  echo "✅ Backend emulators ready!"
  echo "========================================="
  echo ""
  echo "Backend emulators (shared):"
  echo "  FIRESTORE_EMULATOR_HOST=localhost:${FIRESTORE_PORT}"
  echo "  FIREBASE_AUTH_EMULATOR_HOST=localhost:${AUTH_PORT}"
  echo "  STORAGE_EMULATOR_HOST=localhost:${STORAGE_PORT}"
  echo "  Emulator UI: http://localhost:${UI_PORT}"
  echo ""
  echo "Hosting emulator: SKIPPED (SKIP_HOSTING=1)"
  echo ""

  # Use exit when run directly, return when sourced
  if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    exit 0
  else
    return 0
  fi
fi

echo "Starting per-worktree hosting emulator..."
echo "  Port: ${HOSTING_PORT}"
echo "  Project: ${PROJECT_ID}"
echo "  Serving from: Paths configured in firebase.json (relative to repository root: ${PROJECT_ROOT})"

# Validate port availability
# allocate-test-ports.sh found an available port, but verify it's still free
# (race condition possible if another process claimed it between allocation and startup)
if ! is_port_available ${HOSTING_PORT}; then
  echo "ERROR: Allocated port ${HOSTING_PORT} is not available" >&2
  echo "Port allocation race condition detected!" >&2
  echo "" >&2
  echo "Port owner details:" >&2
  if ! get_port_owner ${HOSTING_PORT} >&2; then
    echo "  (Unable to determine port owner - port may have been freed)" >&2
  fi
  echo "" >&2
  echo "This can happen when:" >&2
  echo "  1. Another process claimed the port between allocation and startup" >&2
  echo "  2. A previous emulator instance is still running" >&2
  echo "" >&2
  echo "Solutions:" >&2
  echo "  - Try running the script again (port allocation will find a different port)" >&2
  echo "  - Run: infrastructure/scripts/stop-emulators.sh to stop all emulators" >&2
  echo "  - Check for processes holding ports: lsof -i :5000-5990" >&2
  exit 1
fi

# Change to repository root
cd "${PROJECT_ROOT}"

# Create temporary firebase config for this worktree with custom hosting port
# Put it in PROJECT_ROOT so relative paths work correctly
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"

# Validate firebase.json exists and is readable
if [ ! -f firebase.json ]; then
  echo "ERROR: firebase.json not found in repository root" >&2
  echo "Current directory: $(pwd)" >&2
  exit 1
fi

# Validate firebase.json is valid JSON
if ! jq empty firebase.json 2>/dev/null; then
  echo "ERROR: firebase.json contains invalid JSON syntax" >&2
  echo "Run: jq . firebase.json" >&2
  exit 1
fi

# Map app directory names to Firebase site IDs
# This handles apps where directory name != site ID in firebase.json
get_firebase_site_id() {
  local app_name="$1"
  case "$app_name" in
    print) echo "print-dfb47" ;;
    videobrowser) echo "videobrowser-7696a" ;;
    *) echo "$app_name" ;;  # Default: use app name as-is
  esac
}

# Filter hosting config to only include the site being tested (if APP_NAME provided)
# Keep paths relative - Firebase emulator resolves them from CWD (PROJECT_ROOT)
# Remove site/target fields - hosting emulator serves all configs at root path
if [ -n "$APP_NAME" ]; then
  # Map directory name to Firebase site ID
  SITE_ID=$(get_firebase_site_id "$APP_NAME")

  # Extract the one site config and remove site/target fields
  # Capture stderr separately to avoid mixing error messages with JSON output
  JQ_ERROR=$(mktemp)
  HOSTING_CONFIG=$(jq --arg site "$SITE_ID" \
    '.hosting[] | select(.site == $site) | del(.site, .target)' \
    firebase.json 2>"$JQ_ERROR")
  JQ_EXIT=$?

  if [ $JQ_EXIT -ne 0 ]; then
    echo "ERROR: jq command failed while processing firebase.json" >&2
    echo "jq exit code: $JQ_EXIT" >&2
    if [ -s "$JQ_ERROR" ]; then
      echo "jq error output:" >&2
      cat "$JQ_ERROR" >&2
    fi
    rm -f "$JQ_ERROR"
    exit 1
  fi
  rm -f "$JQ_ERROR"

  if [ -z "$HOSTING_CONFIG" ] || [ "$HOSTING_CONFIG" = "null" ]; then
    echo "ERROR: No hosting config found for site '$SITE_ID' (app: '$APP_NAME') in firebase.json" >&2
    AVAILABLE_SITES=$(jq -r '.hosting[].site // empty' firebase.json 2>/dev/null)
    if [ -n "$AVAILABLE_SITES" ]; then
      echo "Available sites:" >&2
      echo "$AVAILABLE_SITES" | sed 's/^/  - /' >&2
    fi
    exit 1
  fi

  echo "Hosting only site: $SITE_ID (app: $APP_NAME)"
else
  # For all sites, keep as array but remove site/target fields
  # Capture stderr separately to avoid mixing error messages with JSON output
  JQ_ERROR=$(mktemp)
  HOSTING_CONFIG=$(jq '.hosting | map(del(.site, .target))' firebase.json 2>"$JQ_ERROR")
  JQ_EXIT=$?

  if [ $JQ_EXIT -ne 0 ]; then
    echo "ERROR: jq command failed while processing firebase.json" >&2
    echo "jq exit code: $JQ_EXIT" >&2
    if [ -s "$JQ_ERROR" ]; then
      echo "jq error output:" >&2
      cat "$JQ_ERROR" >&2
    fi
    rm -f "$JQ_ERROR"
    exit 1
  fi
  rm -f "$JQ_ERROR"

  if [ -z "$HOSTING_CONFIG" ] || [ "$HOSTING_CONFIG" = "null" ] || [ "$HOSTING_CONFIG" = "[]" ]; then
    echo "ERROR: No hosting configs found in firebase.json" >&2
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
  # Read PID file before deletion if it exists
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
  fi

  # Always cleanup files, even if no PID file exists yet
  # This handles the case where emulator fails before PID is written
  rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
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

# Extract PGID with error handling
PS_OUTPUT=$(ps -o pgid= -p $HOSTING_PID 2>&1)
PS_EXIT=$?

if [ $PS_EXIT -ne 0 ]; then
  echo "ERROR: ps command failed to extract PGID for PID ${HOSTING_PID}" >&2
  echo "ps exit code: $PS_EXIT" >&2
  echo "ps output: $PS_OUTPUT" >&2

  # Check if process actually exists
  if ! kill -0 $HOSTING_PID 2>/dev/null; then
    echo "ERROR: Process ${HOSTING_PID} does not exist - emulator failed to start!" >&2
    echo "Last 50 lines of log:" >&2
    tail -n 50 "$HOSTING_LOG_FILE" >&2
    rm -f "$HOSTING_PID_FILE"
    rm -f "$TEMP_CONFIG"
    exit 1
  fi

  # Process exists but ps command failed (platform incompatibility)
  echo "Platform: $(uname -s)" >&2
  echo "WARNING: PGID extraction failed - cleanup will be incomplete!" >&2
  echo "Child processes may continue running after script exits." >&2
  echo "Falling back to PID-only tracking" >&2
  echo "${HOSTING_PID}" > "$HOSTING_PID_FILE"
  echo "Hosting emulator started with PID: ${HOSTING_PID} (PGID unavailable)"
else
  # Parse PGID from ps output (remove whitespace)
  HOSTING_PGID=$(echo "$PS_OUTPUT" | tr -d ' ')

  if [ -z "$HOSTING_PGID" ]; then
    echo "ERROR: ps returned empty PGID for PID ${HOSTING_PID}" >&2
    echo "ps output: '$PS_OUTPUT'" >&2

    # Check if process actually exists
    if ! kill -0 $HOSTING_PID 2>/dev/null; then
      echo "ERROR: Process ${HOSTING_PID} does not exist - emulator failed to start!" >&2
      echo "Last 50 lines of log:" >&2
      tail -n 50 "$HOSTING_LOG_FILE" >&2
      rm -f "$HOSTING_PID_FILE"
      rm -f "$TEMP_CONFIG"
      exit 1
    fi

    # Process exists but PGID is empty string
    echo "Platform: $(uname -s)" >&2
    echo "WARNING: PGID extraction returned empty value - cleanup will be incomplete!" >&2
    echo "Child processes may continue running after script exits." >&2
    echo "Falling back to PID-only tracking" >&2
    echo "${HOSTING_PID}" > "$HOSTING_PID_FILE"
    echo "Hosting emulator started with PID: ${HOSTING_PID} (PGID empty)"
  else
    # Validate PGID is numeric
    if ! [[ "$HOSTING_PGID" =~ ^[0-9]+$ ]]; then
      echo "ERROR: Extracted PGID is not numeric: '$HOSTING_PGID'" >&2
      echo "ps output: '$PS_OUTPUT'" >&2
      echo "WARNING: Using PID-only tracking - cleanup will be incomplete!" >&2
      echo "${HOSTING_PID}" > "$HOSTING_PID_FILE"
      echo "Hosting emulator started with PID: ${HOSTING_PID} (invalid PGID)"
    else
      # Save both PID and PGID for cleanup (format: PID:PGID)
      echo "${HOSTING_PID}:${HOSTING_PGID}" > "$HOSTING_PID_FILE"
      echo "Hosting emulator started with PID: ${HOSTING_PID}, PGID: ${HOSTING_PGID}"
    fi
  fi
fi

echo "Log file: $HOSTING_LOG_FILE"

# Wait for hosting to be ready (check the assigned port)
echo "Waiting for hosting emulator on port ${HOSTING_PORT}..."
RETRY_COUNT=0
MAX_HOSTING_RETRIES=15  # Hosting starts faster than backend
while ! nc -z 127.0.0.1 ${HOSTING_PORT} 2>/dev/null; do
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
