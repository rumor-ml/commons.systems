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

# Get worktree root for registration
# In pool mode: Set from environment by caller
# In singleton mode: Determined later via git rev-parse or fallback to PROJECT_ROOT
WORKTREE_ROOT="${WORKTREE_ROOT:-}"

# Check sandbox requirement BEFORE any emulator operations
check_sandbox_requirement "Starting Firebase emulators" || exit 1

# ============================================================================
# EMULATOR POOL INTEGRATION: Use pool instance ports if provided
# ============================================================================
# Check if POOL_INSTANCE_ID is set (pool mode) or fall back to singleton mode
# Pool mode: Use instance-specific ports from environment variables
# Singleton mode: Allocate ports based on worktree using allocate-test-ports.sh

if [ -n "${POOL_INSTANCE_ID:-}" ]; then
  echo "=== Pool Mode: Using instance-specific ports ==="
  echo "Pool Instance ID: $POOL_INSTANCE_ID"

  # Validate all required pool environment variables are set
  MISSING_POOL_VARS=""
  [ -z "${GCP_PROJECT_ID:-}" ] && MISSING_POOL_VARS="$MISSING_POOL_VARS GCP_PROJECT_ID"
  [ -z "${AUTH_PORT:-}" ] && MISSING_POOL_VARS="$MISSING_POOL_VARS AUTH_PORT"
  [ -z "${FIRESTORE_PORT:-}" ] && MISSING_POOL_VARS="$MISSING_POOL_VARS FIRESTORE_PORT"
  [ -z "${STORAGE_PORT:-}" ] && MISSING_POOL_VARS="$MISSING_POOL_VARS STORAGE_PORT"
  [ -z "${UI_PORT:-}" ] && MISSING_POOL_VARS="$MISSING_POOL_VARS UI_PORT"
  [ -z "${HOSTING_PORT:-}" ] && MISSING_POOL_VARS="$MISSING_POOL_VARS HOSTING_PORT"

  if [ -n "$MISSING_POOL_VARS" ]; then
    echo "ERROR: Pool mode enabled but missing environment variables:$MISSING_POOL_VARS" >&2
    echo "When POOL_INSTANCE_ID is set, all port variables must be provided" >&2
    exit 1
  fi

  # Set PROJECT_ID for consistency with allocate-test-ports.sh
  PROJECT_ID="$GCP_PROJECT_ID"

  echo "  Auth Port: $AUTH_PORT"
  echo "  Firestore Port: $FIRESTORE_PORT"
  echo "  Storage Port: $STORAGE_PORT"
  echo "  UI Port: $UI_PORT"
  echo "  Hosting Port: $HOSTING_PORT"
  echo "  Project ID: $PROJECT_ID"
else
  echo "=== Singleton Mode: Allocating worktree-specific ports ==="
  source "${SCRIPT_DIR}/allocate-test-ports.sh"
fi

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
      # PID file exists - check if process is alive using port-utils.sh parser
      if parse_pid_file "$hosting_pid_file"; then
        # Successfully parsed PID file
        if [ -n "$PARSED_PID" ] && kill -0 "$PARSED_PID" 2>/dev/null; then
          # Process is alive, config is in use
          continue
        fi
        # Process is dead, safe to clean up config below
      else
        # Failed to parse PID file - likely corrupted
        echo "WARNING: Failed to parse PID file $hosting_pid_file - treating as orphaned" >&2
        # Fall through to cleanup (safe default: if we can't read the PID file, clean up the config)
      fi
    fi

    # No active process - safe to remove
    echo "Cleaning orphaned config: $filename (process not running)" >&2
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

# Merge Firestore rules from all apps
echo "Merging Firestore rules from all apps..."
bash "$SCRIPT_DIR/merge-firestore-rules.sh"

# Small delay after merge for filesystem buffers to flush
# The merge script uses atomic writes (mv), so this sleep protects against race
# conditions where the emulator's file watcher might read the rules file during
# the mv operation (between unlink and link system calls)
sleep 1

# Copy merged rules to shared emulator directory so the emulator always sees current rules
# regardless of which worktree started it. This runs even when reusing an existing backend,
# so the emulator's file watcher picks up rules changes from this worktree.
SHARED_RULES_DIR="${SHARED_EMULATOR_DIR}/rules"
mkdir -p "$SHARED_RULES_DIR"

# Copy Firestore rules with error checking
if ! cp "${PROJECT_ROOT}/.firebase/firestore.rules" "${SHARED_RULES_DIR}/firestore.rules"; then
  echo "ERROR: Failed to copy Firestore rules to shared directory" >&2
  echo "Source: ${PROJECT_ROOT}/.firebase/firestore.rules" >&2
  echo "Dest: ${SHARED_RULES_DIR}/firestore.rules" >&2
  echo "Possible causes: missing source file, disk full, permission denied" >&2

  # Check if source file exists
  if [ ! -f "${PROJECT_ROOT}/.firebase/firestore.rules" ]; then
    echo "Source file does not exist - run merge-firestore-rules.sh first" >&2
  fi

  exit 1
fi

# Copy Storage rules with error checking
if ! cp "${PROJECT_ROOT}/shared/storage.rules" "${SHARED_RULES_DIR}/storage.rules"; then
  echo "ERROR: Failed to copy Storage rules to shared directory" >&2
  echo "Source: ${PROJECT_ROOT}/shared/storage.rules" >&2
  echo "Dest: ${SHARED_RULES_DIR}/storage.rules" >&2
  echo "Possible causes: missing source file, disk full, permission denied" >&2

  # Check if source file exists
  if [ ! -f "${PROJECT_ROOT}/shared/storage.rules" ]; then
    echo "Source file does not exist - check repository structure" >&2
  fi

  exit 1
fi

# Lock acquired - check if backend is already running
if nc -z 127.0.0.1 $AUTH_PORT 2>/dev/null; then
  echo "✓ Backend emulators already running - reusing shared instance"
  echo "  Multiple worktrees can connect to the same backend"
else
  echo "Starting shared backend emulators (Auth, Firestore, Storage)..."

  # Change to repository root
  cd "${PROJECT_ROOT}"

  # Create firebase config for backend emulators with custom ports
  # Required for pool mode to use instance-specific ports
  # Config must be in PROJECT_ROOT so Firebase CLI resolves relative paths correctly
  # Cleanup: stop-emulators.sh removes this file on shutdown
  TEMP_BACKEND_CONFIG="${PROJECT_ROOT}/.firebase-backend-${PROJECT_ID}.json"

  # Derive backend config from firebase.json, overriding only ports and rules paths
  # This automatically inherits singleProjectMode, ui.enabled, and any future settings
  # - del(.hosting): backend-only emulators don't need hosting config
  # - Absolute rules paths: emulator watches shared location regardless of starting worktree
  jq --argjson auth "${AUTH_PORT}" \
     --argjson fs "${FIRESTORE_PORT}" \
     --argjson storage "${STORAGE_PORT}" \
     --argjson ui "${UI_PORT}" \
     --arg fsRules "${SHARED_RULES_DIR}/firestore.rules" \
     --arg storageRules "${SHARED_RULES_DIR}/storage.rules" \
     '{
       emulators: (.emulators | del(.hosting) | .auth.port = $auth | .firestore.port = $fs | .storage.port = $storage | .ui.port = $ui),
       storage: {rules: $storageRules},
       firestore: {rules: $fsRules}
     }' "${PROJECT_ROOT}/firebase.json" > "${TEMP_BACKEND_CONFIG}"
  jq_exit_code=$?
  if [ $jq_exit_code -ne 0 ]; then
    echo "ERROR: Failed to generate backend emulator config with jq" >&2
    echo "jq exit code: $jq_exit_code" >&2
    echo "Source: ${PROJECT_ROOT}/firebase.json" >&2
    echo "Dest: ${TEMP_BACKEND_CONFIG}" >&2
    exit 1
  fi

  # Validate generated JSON is valid and not empty
  if [ ! -s "${TEMP_BACKEND_CONFIG}" ]; then
    echo "ERROR: Generated backend config is empty" >&2
    echo "Config file: ${TEMP_BACKEND_CONFIG}" >&2
    exit 1
  fi

  if ! jq empty "${TEMP_BACKEND_CONFIG}" 2>/dev/null; then
    echo "ERROR: Generated backend config contains invalid JSON" >&2
    echo "Config file: ${TEMP_BACKEND_CONFIG}" >&2
    echo "Contents:" >&2
    cat "${TEMP_BACKEND_CONFIG}" >&2
    exit 1
  fi

  # Start ONLY backend emulators (shared)
  # Import seed data from fellspiral/emulator-data (includes QA test user)
  npx firebase-tools emulators:start \
    --only auth,firestore,storage \
    --project="${PROJECT_ID}" \
    --config="${TEMP_BACKEND_CONFIG}" \
    --import="${PROJECT_ROOT}/fellspiral/emulator-data" \
    > "$BACKEND_LOG_FILE" 2>&1 &

  BACKEND_PID=$!
  BACKEND_PGID=$(ps -o pgid= -p $BACKEND_PID 2>/dev/null | tr -d ' ')
  echo "${BACKEND_PID}:${BACKEND_PGID}" > "$BACKEND_PID_FILE"

  echo "Backend emulators started with PID: ${BACKEND_PID}"
  echo "Log file: $BACKEND_LOG_FILE"
  echo "Config file: $TEMP_BACKEND_CONFIG"

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
    echo "ERROR: Deep health check failed - emulators are not fully functional" >&2
    echo "" >&2
    echo "This usually indicates:" >&2
    echo "  - Emulator process crashed after startup" >&2
    echo "  - Network configuration issues" >&2
    echo "  - Corrupted emulator state" >&2
    echo "" >&2
    echo "Check logs at: $BACKEND_LOG_FILE" >&2
    echo "" >&2

    # Clean up failed emulators
    kill $BACKEND_PID 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE" "$TEMP_BACKEND_CONFIG"

    exit 1
  fi
  echo ""

  # Seed QA users after backend emulators are confirmed healthy
  # Runs in singleton mode only (pool mode uses pre-seeded instances)
  # Safe to run multiple times - seed-qa-users.js handles existing users gracefully
  if [ -z "${POOL_INSTANCE_ID:-}" ]; then
    echo "Seeding QA users..."
    if ! command -v node &> /dev/null; then
      echo "ERROR: Node.js not found - QA user seeding requires Node.js" >&2
      echo "Install Node.js or set SKIP_QA_SEEDING=1 to skip" >&2
      if [ -z "${SKIP_QA_SEEDING:-}" ]; then
        exit 1
      else
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "⚠️  QA user seeding SKIPPED (SKIP_QA_SEEDING set)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "E2E tests will FAIL with authentication errors!" >&2
        echo "" >&2
        echo "Tests requiring QA GitHub user (qa-github@test.com) will fail:" >&2
        echo "  - OAuth login flows" >&2
        echo "  - User authentication tests" >&2
        echo "  - Any test using pre-seeded test users" >&2
        echo "" >&2
        echo "To fix: Install Node.js and remove SKIP_QA_SEEDING" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2

        # Set environment variable so test failure logs can reference it
        export QA_SEEDING_SKIPPED="true"
        export TEST_WARNING="NO_QA_USERS"
      fi
    else
      # Set up environment for seed script
      export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:${AUTH_PORT}"
      export GCP_PROJECT_ID="${PROJECT_ID}"

      # Capture stderr to show actual error
      SEED_ERROR=$(node "${SCRIPT_DIR}/seed-qa-users.js" 2>&1)
      SEED_EXIT=$?

      if [ $SEED_EXIT -eq 0 ]; then
        echo "✓ QA users configured"
      else
        echo "ERROR: Failed to seed QA users (exit code: $SEED_EXIT)" >&2
        echo "" >&2

        # Check for specific error patterns to provide targeted advice
        if echo "$SEED_ERROR" | grep -q "Network error"; then
          echo "Error: Cannot connect to Auth emulator" >&2
          echo "" >&2
          echo "Possible causes:" >&2
          echo "  - Auth emulator not fully started (wait longer)" >&2
          echo "  - Wrong port: Check FIREBASE_AUTH_EMULATOR_HOST=${FIREBASE_AUTH_EMULATOR_HOST}" >&2
          echo "  - Firewall blocking localhost connections" >&2
          echo "" >&2
          echo "Try: nc -z 127.0.0.1 ${AUTH_PORT} (should succeed if emulator is ready)" >&2
          echo "" >&2
          echo "Full error output:" >&2
          echo "$SEED_ERROR" | sed 's/^/  /' >&2
        elif echo "$SEED_ERROR" | grep -q "raw id exists"; then
          # This is actually success - duplicate is handled gracefully by seed script
          echo "Note: User already exists (this is normal)" >&2
          echo "✓ QA users configured (pre-existing)" >&2
          SEED_EXIT=0  # Treat as success
        else
          echo "Full error output:" >&2
          echo "$SEED_ERROR" | sed 's/^/  /' >&2
        fi

        if [ $SEED_EXIT -ne 0 ]; then
          echo "" >&2
          echo "This will cause E2E test authentication to fail" >&2

          if [ -n "${SKIP_QA_SEEDING:-}" ]; then
            echo "⚠️  SKIP_QA_SEEDING is set - continuing without QA users" >&2
            echo "   E2E tests WILL FAIL with authentication errors" >&2
          else
            exit 1
          fi
        fi
      fi
    fi
    echo ""
  fi

  # Register worktree for singleton mode (after backend emulators are confirmed running)
  if [ -z "${POOL_INSTANCE_ID:-}" ]; then
    # Ensure WORKTREE_ROOT is set
    if [ -z "$WORKTREE_ROOT" ]; then
      WORKTREE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || WORKTREE_ROOT="$PROJECT_ROOT"
    fi

    echo "Registering worktree in shared emulator registry..."
    REGISTER_ERROR=$("${SCRIPT_DIR}/worktree-registry.sh" register "$WORKTREE_ROOT" "$PROJECT_ID" "singleton" 2>&1)
    REGISTER_EXIT=$?

    if [ $REGISTER_EXIT -ne 0 ]; then
      echo "ERROR: Failed to register worktree (exit code: $REGISTER_EXIT)" >&2
      echo "Error output:" >&2
      echo "$REGISTER_ERROR" | sed 's/^/  /' >&2
      echo "" >&2
      echo "Registry path: ~/.firebase-emulators/worktree-registrations.json" >&2
      echo "" >&2
      echo "This will cause premature emulator shutdown when other worktrees stop" >&2
      exit 1
    fi

    echo "✓ Worktree registered: $WORKTREE_ROOT"
  fi
fi

echo ""
echo "=== EMULATOR RULES DIAGNOSTIC ==="
echo "Config file firestore section:"
grep -A 3 '"firestore"' "${PROJECT_ROOT}/firebase.json" || echo "No firestore section found"
echo ""
echo "Waiting 3s for emulator logs..."
sleep 3
echo "Emulator log (rules-related lines):"
grep -i "rules\|firestore" "$BACKEND_LOG_FILE" | head -30 || echo "No rules info in log"
echo "=== END EMULATOR DIAGNOSTIC ==="

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

# ============================================================================
# FIREBASE.JSON VALIDATION - Validate ONCE before port retry loop
# ============================================================================
# This prevents confusing error messages when JQ fails during port retries.
# If JQ fails, we want immediate failure, not "port conflict" messages.

# Change to repository root for firebase.json access
cd "${PROJECT_ROOT}"

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

# Extract hosting config ONCE before port retry loop
# Keep paths relative - Firebase emulator resolves them from CWD (PROJECT_ROOT)
# Remove site/target fields - hosting emulator serves all configs at root path
if [ -n "$APP_NAME" ]; then
  # Map directory name to Firebase site ID (uses shared function from port-utils.sh)
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

# ============================================================================
# PORT RETRY LOOP - Handle port allocation race conditions
# ============================================================================
# Port conflicts can occur between allocation check and emulator binding.
# Retry with exponential backoff and automatic port reallocation on failure.
# NOTE: HOSTING_CONFIG extracted above is reused on all retry attempts.

# INFRASTRUCTURE STABILITY FIX: Increase retry attempts from 3 to 5
# This reduces race conditions during parallel test runs and CI overload
MAX_PORT_RETRIES=5
PORT_RETRY_COUNT=0
HOSTING_STARTED=false
ORIGINAL_HOSTING_PORT="${HOSTING_PORT}"  # Save for error messages

while [ $PORT_RETRY_COUNT -lt $MAX_PORT_RETRIES ] && [ "$HOSTING_STARTED" = "false" ]; do
  if [ $PORT_RETRY_COUNT -gt 0 ]; then
    # Calculate backoff delay: 2^retry (1s, 2s, 4s)
    BACKOFF_DELAY=$((2 ** PORT_RETRY_COUNT))
    echo "Retrying in ${BACKOFF_DELAY}s... (attempt $((PORT_RETRY_COUNT + 1))/${MAX_PORT_RETRIES})"
    sleep $BACKOFF_DELAY
  fi

  echo "  Port: ${HOSTING_PORT}"
  echo "  Project: ${PROJECT_ID}"
  echo "  Serving from: Paths configured in firebase.json (relative to repository root: ${PROJECT_ROOT})"

  # Validate port availability
  # allocate-test-ports.sh found an available port, but verify it's still free
  # (race condition possible if another process claimed it between allocation and startup)
  if ! is_port_available ${HOSTING_PORT}; then
    echo "WARNING: Allocated port ${HOSTING_PORT} is not available" >&2
    echo "Port allocation race condition detected!" >&2
    echo "" >&2
    echo "Port owner details:" >&2
    if ! get_port_owner ${HOSTING_PORT} >&2; then
      echo "  (Unable to determine port owner - port may have been freed)" >&2
    fi
    echo "" >&2

    # Try to find a new port
    PORT_RETRY_COUNT=$((PORT_RETRY_COUNT + 1))
    if [ $PORT_RETRY_COUNT -lt $MAX_PORT_RETRIES ]; then
      # Find next available port (start 10 ports higher)
      NEW_PORT=$(find_available_port $((HOSTING_PORT + 10)) 10 10)
      if [ $? -eq 0 ] && [ -n "$NEW_PORT" ]; then
        echo "Found alternative port: ${NEW_PORT}" >&2
        HOSTING_PORT=$NEW_PORT
        continue
      else
        echo "ERROR: Could not find alternative port" >&2
      fi
    fi

    # All retries exhausted
    echo "ERROR: Failed to allocate hosting port after ${MAX_PORT_RETRIES} attempts" >&2
    echo "Original port: ${ORIGINAL_HOSTING_PORT}" >&2
    echo "" >&2
    echo "Solutions:" >&2
    echo "  - Run: infrastructure/scripts/stop-emulators.sh to stop all emulators" >&2
    echo "  - Check for processes holding ports: lsof -i :5000-5990" >&2
    exit 1
  fi

# Create temporary firebase config for this worktree with custom hosting port
# Put it in PROJECT_ROOT so relative paths work correctly
# NOTE: HOSTING_CONFIG was already extracted and validated before the port retry loop
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"

if ! cat > "${TEMP_CONFIG}" <<EOF
{
  "emulators": {
    "hosting": {
      "port": ${HOSTING_PORT}
    }
  },
  "hosting": ${HOSTING_CONFIG}
}
EOF
then
  echo "ERROR: Failed to write hosting emulator config" >&2
  echo "Target file: ${TEMP_CONFIG}" >&2
  echo "This may indicate disk space or permission issues" >&2
  exit 1
fi

# Cleanup function for hosting emulator (process group)
cleanup_hosting_emulator() {
  # Read PID file before deletion if it exists
  if [ -f "$HOSTING_PID_FILE" ]; then
    if parse_pid_file "$HOSTING_PID_FILE"; then
      # Successfully parsed - use the utility function to kill process group
      kill_process_group "$PARSED_PID" "$PARSED_PGID"
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
    echo "WARNING: Hosting emulator process crashed during startup" >&2

    # Check for port conflict in logs
    if grep -q "EADDRINUSE\|address already in use\|port.*already in use" "$HOSTING_LOG_FILE" 2>/dev/null; then
      echo "Port conflict detected in emulator logs" >&2
      PORT_RETRY_COUNT=$((PORT_RETRY_COUNT + 1))

      # Cleanup failed emulator
      rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"

      if [ $PORT_RETRY_COUNT -lt $MAX_PORT_RETRIES ]; then
        # Find new port and retry
        NEW_PORT=$(find_available_port $((HOSTING_PORT + 10)) 10 10)
        if [ $? -eq 0 ] && [ -n "$NEW_PORT" ]; then
          echo "Found alternative port: ${NEW_PORT}" >&2
          HOSTING_PORT=$NEW_PORT
          continue
        else
          echo "ERROR: Could not find alternative port" >&2
          exit 1
        fi
      else
        echo "ERROR: Failed to start hosting emulator after ${MAX_PORT_RETRIES} port allocation attempts" >&2
        echo "Last 20 lines of emulator log:" >&2
        tail -n 20 "$HOSTING_LOG_FILE" >&2
        exit 1
      fi
    else
      # Non-port-related crash
      echo "ERROR: Hosting emulator crashed with non-port error" >&2
      echo "Last 20 lines of emulator log:" >&2
      tail -n 20 "$HOSTING_LOG_FILE" >&2
      rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
      exit 1
    fi
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

      # Check for port conflict in logs
      if grep -q "EADDRINUSE\|address already in use\|port.*already in use" "$HOSTING_LOG_FILE" 2>/dev/null; then
        echo "Port conflict detected in emulator logs" >&2
        PORT_RETRY_COUNT=$((PORT_RETRY_COUNT + 1))

        # Cleanup failed emulator
        rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"

        if [ $PORT_RETRY_COUNT -lt $MAX_PORT_RETRIES ]; then
          # Find new port and retry
          NEW_PORT=$(find_available_port $((HOSTING_PORT + 10)) 10 10)
          if [ $? -eq 0 ] && [ -n "$NEW_PORT" ]; then
            echo "Found alternative port: ${NEW_PORT}" >&2
            HOSTING_PORT=$NEW_PORT
            continue 2  # Continue outer port retry loop
          else
            echo "ERROR: Could not find alternative port" >&2
            exit 1
          fi
        else
          echo "ERROR: Failed to start hosting emulator after ${MAX_PORT_RETRIES} port allocation attempts" >&2
          echo "Last 20 lines of emulator log:" >&2
          tail -n 20 "$HOSTING_LOG_FILE" >&2
          exit 1
        fi
      else
        # Non-port-related crash
        echo "ERROR: Hosting emulator crashed during health check" >&2
        echo "Last 20 lines of emulator log:" >&2
        tail -n 20 "$HOSTING_LOG_FILE" >&2
        rm -f "$HOSTING_PID_FILE" "$TEMP_CONFIG"
        exit 1
      fi
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

  # Health check passed - mark as successfully started
  HOSTING_STARTED=true
  echo "✓ Hosting emulator ready on port ${HOSTING_PORT}"
done  # End of port retry loop

# If we got here after retries, report the recovery
if [ $PORT_RETRY_COUNT -gt 0 ]; then
  echo "✓ Successfully started hosting emulator after ${PORT_RETRY_COUNT} port conflict(s)"
  echo "  Original port: ${ORIGINAL_HOSTING_PORT}"
  echo "  Final port: ${HOSTING_PORT}"
fi

# Register worktree for pool mode (after hosting emulator is ready and pool instance is claimed)
if [ -n "${POOL_INSTANCE_ID:-}" ]; then
  # Ensure WORKTREE_ROOT is set
  if [ -z "$WORKTREE_ROOT" ]; then
    WORKTREE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || WORKTREE_ROOT="$PROJECT_ROOT"
  fi

  if ! "${SCRIPT_DIR}/worktree-registry.sh" register "$WORKTREE_ROOT" "$PROJECT_ID" "pool" "$POOL_INSTANCE_ID" 2>/dev/null; then
    echo "⚠️  Failed to register worktree (non-critical)" >&2
  fi
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
