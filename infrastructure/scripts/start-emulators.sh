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

# Check sandbox requirement BEFORE any emulator operations
check_sandbox_requirement "Starting Firebase emulators" || exit 1

source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Configuration
MAX_RETRIES=120  # Increased to handle system overload (2 minutes total)
RETRY_INTERVAL=1

# Shared directory for backend emulator state (shared across all worktrees)
SHARED_EMULATOR_DIR="${HOME}/.firebase-emulators"
mkdir -p "${SHARED_EMULATOR_DIR}"

# PID and log files
# Backend emulator is SHARED across worktrees - use shared location
BACKEND_PID_FILE="${SHARED_EMULATOR_DIR}/firebase-backend-emulators.pid"
BACKEND_LOG_FILE="${SHARED_EMULATOR_DIR}/firebase-backend-emulators.log"
BACKEND_LOCK_FILE="${SHARED_EMULATOR_DIR}/firebase-backend-emulators.lock"

# Hosting emulator is PER-WORKTREE - use worktree-local location
HOSTING_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"
HOSTING_LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.log"

# Ensure temp directory exists (for hosting emulator files)
mkdir -p "${PROJECT_ROOT}/tmp/infrastructure"

# ============================================================================
# STARTUP CLEANUP PHASE - Remove orphaned temp configs from previous runs
# ============================================================================

cleanup_orphaned_configs() {
  local cleaned_count=0

  # Find all .firebase-*.json files in project root
  for config_file in "${PROJECT_ROOT}"/.firebase-*.json; do
    # Check if glob matched any files
    [ -e "$config_file" ] || continue

    # Extract project ID from filename (.firebase-PROJECT_ID.json)
    local filename=$(basename "$config_file")
    local config_project_id="${filename#.firebase-}"
    config_project_id="${config_project_id%.json}"

    # Check if there's a corresponding active hosting emulator
    local hosting_pid_file="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${config_project_id}.pid"

    if [ -f "$hosting_pid_file" ]; then
      # PID file exists - check if process is alive
      local pid pgid
      if IFS=':' read -r pid pgid < "$hosting_pid_file" 2>/dev/null; then
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
          # Process is alive, config is in use
          continue
        fi
      fi
    fi

    # No active process - safe to remove
    echo "Cleaning orphaned config: $filename" >&2
    rm -f "$config_file"
    cleaned_count=$((cleaned_count + 1))
  done

  if [ $cleaned_count -gt 0 ]; then
    echo "✓ Cleaned $cleaned_count orphaned temp config(s)"
  fi
}

# Run cleanup before starting emulators
cleanup_orphaned_configs

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

# Acquire lock to coordinate backend emulator startup across worktrees
# This prevents race conditions when multiple worktrees try to start simultaneously
# Uses cross-platform file-based locking with atomic operations

LOCK_MAX_WAIT=180  # Maximum seconds to wait for lock (increased for system overload)
LOCK_RETRY_INTERVAL=0.5  # Seconds between lock attempts

echo "Acquiring backend emulator lock..."

# Check for stale lock BEFORE attempting acquisition
if is_lock_stale "$BACKEND_LOCK_FILE" 180; then
  echo "✓ Removed stale lock from previous crashed process"
fi

# Try to acquire lock with timeout
LOCK_ACQUIRED=0
LOCK_START_TIME=$(date +%s)

while [ $LOCK_ACQUIRED -eq 0 ]; do
  # Try to create lock file atomically using mkdir (portable across Linux/macOS)
  # mkdir is atomic - either succeeds or fails, no race condition
  if mkdir "$BACKEND_LOCK_FILE" 2>/dev/null; then
    LOCK_ACQUIRED=1

    # Store our PID in the lock directory for debugging
    echo $$ > "$BACKEND_LOCK_FILE/pid"

    # Store timestamp for age-based staleness detection
    date +%s > "$BACKEND_LOCK_FILE/timestamp"

    # Restrict permissions to user-only (security hardening)
    chmod 700 "$BACKEND_LOCK_FILE" 2>/dev/null || true
    chmod 600 "$BACKEND_LOCK_FILE/pid" 2>/dev/null || true

    break
  fi

  # Check if we've exceeded max wait time
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - LOCK_START_TIME))

  # Check for stale lock every 10 seconds during wait
  if [ $((ELAPSED % 10)) -eq 0 ] && [ $ELAPSED -gt 0 ]; then
    if is_lock_stale "$BACKEND_LOCK_FILE" 180; then
      echo "✓ Removed stale lock during acquisition"
      # Retry immediately
      continue
    fi
  fi

  if [ $ELAPSED -ge $LOCK_MAX_WAIT ]; then
    echo "ERROR: Failed to acquire backend emulator lock after ${LOCK_MAX_WAIT} seconds" >&2
    echo "Lock holder PID: $(cat "$BACKEND_LOCK_FILE/pid" 2>/dev/null || echo 'unknown')" >&2

    # Final staleness check before giving up
    if is_lock_stale "$BACKEND_LOCK_FILE" 60; then
      echo "✓ Removed stale lock on final check, retrying..." >&2
      LOCK_START_TIME=$(date +%s)
      continue
    fi

    echo "If you're sure no other emulator startup is in progress, remove:" >&2
    echo "  rm -rf \"$BACKEND_LOCK_FILE\"" >&2
    exit 1
  fi

  # Wait before retrying
  sleep $LOCK_RETRY_INTERVAL
done

echo "✓ Backend emulator lock acquired"

# Cleanup function to release lock on exit
cleanup_backend_lock() {
  if [ -d "$BACKEND_LOCK_FILE" ]; then
    rm -rf "$BACKEND_LOCK_FILE"
    echo "✓ Backend emulator lock released"
  fi
}

# Register cleanup on exit (trap fires even on early exits/errors)
trap cleanup_backend_lock EXIT

# Lock acquired - check if backend is already running
if nc -z 127.0.0.1 $AUTH_PORT 2>/dev/null; then
  echo "✓ Backend emulators already running - reusing shared instance"
  echo "  Multiple worktrees can connect to the same backend"
else
  echo "Starting shared backend emulators (Auth, Firestore, Storage)..."

  # Change to repository root
  cd "${PROJECT_ROOT}"

  # Start ONLY backend emulators (shared)
  # Import seed data from fellspiral/emulator-data (includes QA test user)
  npx firebase-tools emulators:start \
    --only auth,firestore,storage \
    --project="${PROJECT_ID}" \
    --import="${PROJECT_ROOT}/fellspiral/emulator-data" \
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

  # INFRASTRUCTURE STABILITY FIX: Perform deep health check after startup
  # This verifies actual functionality, not just port availability
  echo ""
  if ! deep_health_check "127.0.0.1" "${AUTH_PORT}" "127.0.0.1" "${FIRESTORE_PORT}" "${PROJECT_ID}"; then
    echo "⚠️  Deep health check failed - emulators may not be fully functional" >&2
    # Don't fail startup, but warn user
  fi
  echo ""
fi

# Lock will be automatically released by trap on exit

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

# Validate port is still available before starting emulator
# Port was allocated by allocate-test-ports.sh, but verify it's still free
# (race condition possible if another process claimed it between allocation and startup)
echo "  Port: ${HOSTING_PORT}"
echo "  Project: ${PROJECT_ID}"
echo "  Serving from: Paths configured in firebase.json (relative to repository root: ${PROJECT_ROOT})"

if ! is_port_available ${HOSTING_PORT}; then
  echo "ERROR: Allocated hosting port ${HOSTING_PORT} is no longer available" >&2
  echo "Port allocation race condition detected!" >&2
  echo "" >&2
  echo "Another process claimed the port between allocation and startup." >&2
  echo "Port owner details:" >&2
  if ! get_port_owner ${HOSTING_PORT} >&2; then
    echo "  (Unable to determine port owner)" >&2
  fi
  echo "" >&2
  echo "Solutions:" >&2
  echo "  1. Retry the test command (ports will be rechecked)" >&2
  echo "  2. Stop all emulators: infrastructure/scripts/stop-emulators.sh" >&2
  echo "  3. Check port owner: lsof -i :${HOSTING_PORT}" >&2
  echo "  4. Kill the process using the port, then retry" >&2
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
    budget) echo "budget-81cb7" ;;
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
# Use setsid to create new session where PGID == PID (no parsing needed)
if command -v setsid >/dev/null 2>&1; then
  # setsid available - use it for reliable process group creation
  setsid npx firebase-tools emulators:start \
    --only hosting \
    --project="${PROJECT_ID}" \
    --config "${TEMP_CONFIG}" \
    > "$HOSTING_LOG_FILE" 2>&1 &

  HOSTING_PID=$!
  # With setsid, PGID == PID (process is session leader)
  HOSTING_PGID=$HOSTING_PID

  echo "Hosting emulator started with PID: ${HOSTING_PID}, PGID: ${HOSTING_PGID} (setsid)"
else
  # setsid not available - fall back to bash job control with ps parsing
  set -m  # Enable job control
  npx firebase-tools emulators:start \
    --only hosting \
    --project="${PROJECT_ID}" \
    --config "${TEMP_CONFIG}" \
    > "$HOSTING_LOG_FILE" 2>&1 &

  HOSTING_PID=$!

  # Extract PGID using ps (fallback method)
  if HOSTING_PGID=$(ps -o pgid= -p $HOSTING_PID 2>/dev/null | tr -d ' ') && \
     [ -n "$HOSTING_PGID" ] && [[ "$HOSTING_PGID" =~ ^[0-9]+$ ]]; then
    echo "Hosting emulator started with PID: ${HOSTING_PID}, PGID: ${HOSTING_PGID} (job control)"
  else
    echo "WARNING: Could not extract PGID, using PID-only tracking" >&2
    HOSTING_PGID=""
    echo "Hosting emulator started with PID: ${HOSTING_PID} (PGID unavailable)"
  fi
fi

# Save both PID and PGID for cleanup (format: PID:PGID or PID: if no PGID)
if [ -n "$HOSTING_PGID" ]; then
  echo "${HOSTING_PID}:${HOSTING_PGID}" > "$HOSTING_PID_FILE"
else
  echo "${HOSTING_PID}:" > "$HOSTING_PID_FILE"
fi

echo "Log file: $HOSTING_LOG_FILE"

  # Brief delay to let emulator initialize and write any immediate errors
  sleep 1

  # Check if process crashed immediately (port conflict or other startup error)
  if ! kill -0 $HOSTING_PID 2>/dev/null; then
    echo "ERROR: Hosting emulator process crashed during startup" >&2
    echo "Last 20 lines of emulator log:" >&2
    tail -n 20 "$HOSTING_LOG_FILE" >&2
    rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
    exit 1
  fi

  # Wait for hosting to be ready (check the assigned port)
  echo "Waiting for hosting emulator on port ${HOSTING_PORT}..."
  RETRY_COUNT=0
  MAX_HOSTING_RETRIES=120  # Increased to handle system overload (matches backend timeout)
  RETRY_DELAY=0.1          # Start with 100ms, exponential backoff
  MAX_RETRY_DELAY=5        # Cap at 5 seconds
  ELAPSED_TIME=0
  while ! nc -z 127.0.0.1 ${HOSTING_PORT} 2>/dev/null; do
    # Check if process is still alive during wait
    if ! kill -0 $HOSTING_PID 2>/dev/null; then
      echo "ERROR: Hosting emulator process died during startup wait" >&2
      echo "Last 20 lines of emulator log:" >&2
      tail -n 20 "$HOSTING_LOG_FILE" >&2
      rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
      exit 1
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_HOSTING_RETRIES ]; then
      echo "ERROR: Hosting emulator failed to start after ${MAX_HOSTING_RETRIES} retries (~${ELAPSED_TIME}s elapsed)"
      echo "Last 20 lines of emulator log:"
      tail -n 20 "$HOSTING_LOG_FILE"
      kill $HOSTING_PID 2>/dev/null || true
      rm -f "$HOSTING_PID_FILE"
      rm -f "$TEMP_CONFIG"
      exit 1
    fi

    # Exponential backoff: 0.1s, 0.2s, 0.4s, 0.8s, 1.6s, 3.2s, then capped at 5s
    sleep $RETRY_DELAY
    ELAPSED_TIME=$(awk "BEGIN {print $ELAPSED_TIME + $RETRY_DELAY}")

    # Double the delay for next iteration, but cap at max_delay
    RETRY_DELAY=$(awk "BEGIN {d = $RETRY_DELAY * 2; print (d > $MAX_RETRY_DELAY) ? $MAX_RETRY_DELAY : d}")
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
