#!/usr/bin/env bash
# Universal E2E test runner
# Usage: run-e2e-tests.sh <app-type> <app-path>
#
# App types: firebase, go-fullstack, go-tui
# Features: CWD setup, ENV vars, singleton mode (pool optional), platform detection, emulator reuse

set -e

APP_TYPE="$1"
APP_PATH="$2"

if [ -z "$APP_TYPE" ] || [ -z "$APP_PATH" ]; then
  echo "Usage: $0 <app-type> <app-path>"
  echo "App types: firebase, go-fullstack, go-tui"
  exit 1
fi

# Get absolute paths (handles any initial CWD)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source port utilities for health check function
source "${SCRIPT_DIR}/port-utils.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Handle both relative and absolute paths
if [[ "$APP_PATH" = /* ]]; then
  # Already absolute
  APP_PATH_ABS="$APP_PATH"
else
  # Relative path
  APP_PATH_ABS="$(cd "$ROOT_DIR/$APP_PATH" && pwd)"
fi

APP_NAME=$(basename "$APP_PATH_ABS")

echo "=== E2E Tests: $APP_NAME ($APP_TYPE) ==="

# Check sandbox requirement BEFORE any emulator operations
check_sandbox_requirement "Running E2E tests with Firebase emulators" || exit 1

# ============================================================================
# MASTER CLEANUP HANDLER: Composes all cleanup functions
# ============================================================================
# Ensures all cleanup actions run even if traps are set multiple times.
# Individual cleanup functions register themselves with add_cleanup_handler.
CLEANUP_FUNCTIONS=()

add_cleanup_handler() {
  local func_name="$1"
  # Check if already added to avoid duplicates
  for existing in "${CLEANUP_FUNCTIONS[@]}"; do
    [[ "$existing" = "$func_name" ]] && return 0
  done
  CLEANUP_FUNCTIONS+=("$func_name")
}

run_all_cleanup() {
  local cleanup_failed=false
  local failed_handlers=()

  for func in "${CLEANUP_FUNCTIONS[@]}"; do
    if declare -f "$func" > /dev/null; then
      echo "Running cleanup: $func" >&2

      if ! "$func" 2>&1; then
        echo "WARNING: Cleanup handler '$func' failed" >&2
        cleanup_failed=true
        failed_handlers+=("$func")
      fi
    fi
  done

  if [ "$cleanup_failed" = "true" ]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "⚠️  CLEANUP FAILURES DETECTED" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "The following cleanup handlers failed:" >&2
    for handler in "${failed_handlers[@]}"; do
      echo "  - $handler" >&2
    done
    echo "" >&2
    echo "This may leave system resources in inconsistent state:" >&2
    echo "  - Pool instances may remain claimed" >&2
    echo "  - Emulator processes may still be running" >&2
    echo "  - Temp files may not be cleaned up" >&2
    echo "" >&2
    echo "Manual cleanup may be required before next test run" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  fi
}

trap run_all_cleanup EXIT

# ============================================================================
# EMULATOR POOL INTEGRATION: Claim instance from pool if available
# ============================================================================
# Try to claim a pool instance for parallel test execution
# Falls back to singleton mode if pool is not initialized

POOL_INSTANCE_ID=""
POOL_INSTANCE_CLAIMED=false

# Source emulator pool utilities
EMULATOR_POOL_SCRIPT="${SCRIPT_DIR}/emulator-pool.sh"

if [ -f "$EMULATOR_POOL_SCRIPT" ] && [ -f "${HOME}/.firebase-emulator-pool/pool.json" ]; then
  echo "=== Attempting to claim emulator pool instance ==="

  # Claim an instance from the pool
  # TODO(#1885): Extract repeated mktemp/capture/display/rm error handling pattern into helper function
  CLAIM_ERROR=$(mktemp)
  if POOL_INSTANCE_JSON=$("$EMULATOR_POOL_SCRIPT" claim 2>"$CLAIM_ERROR"); then
    POOL_INSTANCE_ID=$(echo "$POOL_INSTANCE_JSON" | jq -r '.id')
    POOL_INSTANCE_CLAIMED=true

    # Extract instance-specific ports from pool configuration
    export GCP_PROJECT_ID=$(echo "$POOL_INSTANCE_JSON" | jq -r '.projectId')
    export AUTH_PORT=$(echo "$POOL_INSTANCE_JSON" | jq -r '.authPort')
    export FIRESTORE_PORT=$(echo "$POOL_INSTANCE_JSON" | jq -r '.firestorePort')
    export STORAGE_PORT=$(echo "$POOL_INSTANCE_JSON" | jq -r '.storagePort')
    export UI_PORT=$(echo "$POOL_INSTANCE_JSON" | jq -r '.uiPort')
    export HOSTING_PORT=$(echo "$POOL_INSTANCE_JSON" | jq -r '.hostingPort')

    # Set emulator host variables for consistency
    export FIREBASE_AUTH_EMULATOR_HOST="localhost:${AUTH_PORT}"
    export FIRESTORE_EMULATOR_HOST="localhost:${FIRESTORE_PORT}"
    export STORAGE_EMULATOR_HOST="localhost:${STORAGE_PORT}"

    echo "✓ Claimed pool instance: $POOL_INSTANCE_ID"
    echo "  Ports: Auth=$AUTH_PORT, Firestore=$FIRESTORE_PORT, Storage=$STORAGE_PORT, Hosting=$HOSTING_PORT"

    # Set up cleanup handler to release instance on exit
    release_pool_instance() {
      if [ "$POOL_INSTANCE_CLAIMED" = "true" ] && [ -n "$POOL_INSTANCE_ID" ]; then
        echo "Releasing pool instance: $POOL_INSTANCE_ID"
        if ! "$EMULATOR_POOL_SCRIPT" release "$POOL_INSTANCE_ID" 2>&1; then
          echo "WARNING: Failed to release pool instance $POOL_INSTANCE_ID" >&2
          echo "Pool may be in inconsistent state. Run: $EMULATOR_POOL_SCRIPT status" >&2
        fi
      fi
    }
    add_cleanup_handler release_pool_instance
    rm -f "$CLAIM_ERROR"
  else
    echo "⚠️  Failed to claim pool instance - falling back to singleton mode"
    if [ -s "$CLAIM_ERROR" ]; then
      echo "   Reason:" >&2
      cat "$CLAIM_ERROR" | sed 's/^/     /' >&2
    else
      echo "   Reason: Claim command failed with no error output" >&2
      echo "   This may indicate:" >&2
      echo "     - emulator-pool.sh not found or not executable" >&2
      echo "     - Missing dependencies (jq, pool.json)" >&2
      echo "     - Script execution error" >&2
      echo "   Check: ls -l $EMULATOR_POOL_SCRIPT" >&2
    fi
    rm -f "$CLAIM_ERROR"
  fi
else
  echo "⚠️  Emulator pool not initialized - using singleton mode"
fi

echo "=================================================="
echo ""

# ============================================================================
# SUPERVISOR DETECTION: Check if supervisor is managing emulators
# ============================================================================
# TODO(#1714): Add test coverage for supervisor detection, stale PID handling, and multi-worktree hosting startup
SUPERVISOR_PID_FILE="$HOME/.firebase-emulators/supervisor.pid"

# Check if supervisor is already running
is_supervisor_running() {
  if [[ -f "$SUPERVISOR_PID_FILE" ]]; then
    local pid
    pid=$(cat "$SUPERVISOR_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      # Check if the process cmdline contains "emulator-supervisor" string
      # This prevents PID reuse by unrelated processes (basic validation, not cryptographic)
      local cmdline
      cmdline=$(cat /proc/"$pid"/cmdline 2>/dev/null | tr '\0' ' ' || echo "")
      if [[ "$cmdline" == *"emulator-supervisor"* ]]; then
        echo "✓ Supervisor already running (PID: $pid)"
        return 0
      else
        # PID file is stale - process exists but is not the supervisor
        echo "⚠️  Stale supervisor PID file found (PID: $pid is not supervisor), removing..."
        rm -f "$SUPERVISOR_PID_FILE"
      fi
    else
      rm -f "$SUPERVISOR_PID_FILE"
    fi
  fi
  return 1
}

# ============================================================================
# EMULATOR REUSE: Check if emulators are already running before allocation
# ============================================================================
# If .test-env.json exists and emulators are healthy, reuse them instead of
# starting new ones. This prevents port exhaustion when dev server is running.
# TODO(#1713): Add test coverage for emulator reuse, app name mismatch detection, and health checks

TEST_ENV_CONFIG="${ROOT_DIR}/.test-env.json"
REUSE_EMULATORS=false

if [ -f "$TEST_ENV_CONFIG" ]; then
  # Extract ports from existing config
  EXISTING_AUTH_HOST=$(jq -r '.emulators.authHost // empty' "$TEST_ENV_CONFIG" 2>/dev/null)
  EXISTING_FIRESTORE_HOST=$(jq -r '.emulators.firestoreHost // empty' "$TEST_ENV_CONFIG" 2>/dev/null)
  EXISTING_HOSTING_PORT=$(jq -r '.emulators.hostingPort // empty' "$TEST_ENV_CONFIG" 2>/dev/null)
  EXISTING_PROJECT_ID=$(jq -r '.emulators.projectId // empty' "$TEST_ENV_CONFIG" 2>/dev/null)
  EXISTING_APP_NAME=$(jq -r '.emulators.appName // empty' "$TEST_ENV_CONFIG" 2>/dev/null)

  if [ -n "$EXISTING_AUTH_HOST" ] && [ -n "$EXISTING_HOSTING_PORT" ]; then
    # Extract port numbers from host strings
    AUTH_PORT_CHECK="${EXISTING_AUTH_HOST##*:}"
    HOSTING_PORT_CHECK="$EXISTING_HOSTING_PORT"

    # Check if both Auth emulator and Hosting emulator are running
    if nc -z 127.0.0.1 "$AUTH_PORT_CHECK" 2>/dev/null && \
       nc -z 127.0.0.1 "$HOSTING_PORT_CHECK" 2>/dev/null; then

      # Prevent cross-app contamination when reusing emulators
      # Bug: audiobrowser tests leave hosting emulator running. When fellspiral runs next,
      # it detects the port in use and reuses it, but emulator serves wrong app files.
      # Fix: Check stored appName matches current app before reusing. If mismatch, restart.
      # Testing: Missing - tracked in #1713
      if [ -n "$EXISTING_APP_NAME" ] && [ "$EXISTING_APP_NAME" != "$APP_NAME" ]; then
        echo "⚠️  Hosting emulator is serving different app: $EXISTING_APP_NAME (need: $APP_NAME)"
        echo "   Skipping reuse - will restart hosting emulator for correct app"
        echo ""
        REUSE_EMULATORS=false
      else
        echo "✓ Detected running emulators - reusing existing configuration"
        echo "  Auth: $EXISTING_AUTH_HOST"
        echo "  Hosting: localhost:$EXISTING_HOSTING_PORT"
        echo "  Project: $EXISTING_PROJECT_ID"
        echo "  App: $EXISTING_APP_NAME"
        echo ""

        # Set environment variables from existing config
        export FIREBASE_AUTH_EMULATOR_HOST="$EXISTING_AUTH_HOST"
        export FIRESTORE_EMULATOR_HOST="$EXISTING_FIRESTORE_HOST"
        export STORAGE_EMULATOR_HOST=$(jq -r '.emulators.storageHost // empty' "$TEST_ENV_CONFIG" 2>/dev/null)
        export GCP_PROJECT_ID="$EXISTING_PROJECT_ID"
        export HOSTING_PORT="$EXISTING_HOSTING_PORT"
        export TEST_PORT="$HOSTING_PORT"
        export PORT="$HOSTING_PORT"

        REUSE_EMULATORS=true
      fi
    fi
  fi
fi

if [ "$REUSE_EMULATORS" = "false" ] && [ "$POOL_INSTANCE_CLAIMED" = "false" ]; then
  # Allocate ports based on worktree (singleton mode)
  echo "=== Allocating ports for singleton mode ==="

  # Capture stderr from allocate-test-ports.sh for better diagnostics
  ALLOC_ERROR=$(mktemp)
  ALLOC_EXIT=0
  if ! source "$SCRIPT_DIR/allocate-test-ports.sh" 2>"$ALLOC_ERROR"; then
    ALLOC_EXIT=$?
  fi

  # Check for any stderr output (errors or warnings)
  if [ -s "$ALLOC_ERROR" ]; then
    if [ $ALLOC_EXIT -ne 0 ]; then
      echo "FATAL: Port allocation failed (exit code: $ALLOC_EXIT)" >&2
      echo "" >&2
      echo "Error output from allocate-test-ports.sh:" >&2
    else
      echo "⚠️  Port allocation succeeded with warnings:" >&2
    fi
    cat "$ALLOC_ERROR" | sed 's/^/  /' >&2
    echo "" >&2
  else
    # CRITICAL: No stderr captured but command failed
    if [ $ALLOC_EXIT -ne 0 ]; then
      echo "FATAL: Port allocation failed with no error output (exit code: $ALLOC_EXIT)" >&2
      echo "" >&2
      echo "This usually indicates:" >&2
      echo "  - allocate-test-ports.sh not found at: $SCRIPT_DIR/allocate-test-ports.sh" >&2
      echo "  - Bash syntax error in allocate-test-ports.sh" >&2
      echo "  - Permission denied executing the script" >&2
      echo "" >&2
      echo "Check script existence: ls -l $SCRIPT_DIR/allocate-test-ports.sh" >&2
    fi
  fi
  rm -f "$ALLOC_ERROR"

  if [ $ALLOC_EXIT -ne 0 ]; then
    echo "This could be due to:" >&2
    echo "  - All ports in range 5000-5999 are in use" >&2
    echo "  - allocate-test-ports.sh missing or not executable" >&2
    echo "  - Insufficient permissions" >&2
    echo "" >&2
    echo "Try: infrastructure/scripts/stop-emulators.sh --force-backend" >&2
    exit 1
  fi

  # Validate all critical variables are set by allocate-test-ports.sh
  MISSING_VARS=""
  [ -z "${GCP_PROJECT_ID:-}" ] && MISSING_VARS="$MISSING_VARS GCP_PROJECT_ID"
  [ -z "${FIRESTORE_EMULATOR_HOST:-}" ] && MISSING_VARS="$MISSING_VARS FIRESTORE_EMULATOR_HOST"
  [ -z "${FIREBASE_AUTH_EMULATOR_HOST:-}" ] && MISSING_VARS="$MISSING_VARS FIREBASE_AUTH_EMULATOR_HOST"
  [ -z "${STORAGE_EMULATOR_HOST:-}" ] && MISSING_VARS="$MISSING_VARS STORAGE_EMULATOR_HOST"
  [ -z "${HOSTING_PORT:-}" ] && MISSING_VARS="$MISSING_VARS HOSTING_PORT"

  if [ -n "$MISSING_VARS" ]; then
    echo "FATAL: Required variables not set by allocate-test-ports.sh:" >&2
    echo "  Missing:$MISSING_VARS" >&2
    echo "" >&2
    echo "This indicates a bug in the port allocation script" >&2
    echo "Check script output above for errors" >&2
    exit 1
  fi
elif [ "$POOL_INSTANCE_CLAIMED" = "true" ]; then
  echo "✓ Pool instance ports already configured (skipping allocate-test-ports.sh)"
else
  # Clear Firestore data when reusing emulators to ensure test isolation
  # This prevents stale data from previous test runs affecting current tests
  # Note: ALLOW_STALE_DATA=true override bypasses this (may cause flaky tests)
  FIRESTORE_PORT="${FIRESTORE_EMULATOR_HOST##*:}"
  FIRESTORE_HOST="${FIRESTORE_EMULATOR_HOST%%:*}"

  echo ""
  echo "=== Clearing Firestore Data (Reused Emulators) ==="
  CLEAR_ERROR=$(mktemp)
  if ! clear_firestore_data "$FIRESTORE_HOST" "$FIRESTORE_PORT" "$GCP_PROJECT_ID" 2>"$CLEAR_ERROR"; then
    echo "ERROR: Firestore data clearing failed" >&2
    echo "" >&2
    if [ -s "$CLEAR_ERROR" ]; then
      echo "Error details:" >&2
      cat "$CLEAR_ERROR" | sed 's/^/  /' >&2
      echo "" >&2
    fi
    rm -f "$CLEAR_ERROR"

    if [ "${ALLOW_STALE_DATA:-false}" = "true" ]; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
      echo "⚠️  WARNING: Running tests with STALE DATA" >&2
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
      echo "" >&2
      echo "Firestore data clearing FAILED but ALLOW_STALE_DATA=true" >&2
      echo "" >&2
      echo "CRITICAL: Test results are UNRELIABLE in this mode!" >&2
      echo "" >&2
      echo "Risks:" >&2
      echo "  - Tests may fail due to data from previous runs" >&2
      echo "  - Assertions may pass incorrectly on stale data" >&2
      echo "  - Timing-dependent failures (A passes alone, fails after B)" >&2
      echo "  - Cannot trust test results for code validation" >&2
      echo "" >&2
      echo "This mode should ONLY be used for debugging data clearing issues" >&2
      echo "DO NOT merge code validated with ALLOW_STALE_DATA=true" >&2
      echo "" >&2
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

      # Add marker to test output
      export TEST_ENV_STALE_DATA="true"
      export TEST_WARNING="STALE_DATA_MODE"

      # Sleep to ensure user sees the warning
      sleep 3
    else
      echo "Firestore data must be cleared to ensure test isolation" >&2
      echo "" >&2
      echo "Recovery options:" >&2
      echo "  1. Restart emulators: infrastructure/scripts/stop-emulators.sh && infrastructure/scripts/start-emulators.sh" >&2
      echo "  2. Debug data clearing: Check emulator logs, verify API endpoint" >&2
      echo "  3. Override (DEBUG ONLY): ALLOW_STALE_DATA=true $0 $@" >&2
      echo "" >&2
      echo "WARNING: Do not use ALLOW_STALE_DATA for actual validation" >&2
      exit 1
    fi
  else
    rm -f "$CLEAR_ERROR"
  fi
  echo "===================================================="
  echo ""
fi

echo ""
echo "=== Port Configuration ==="
echo "Hosting Port: ${HOSTING_PORT}"
echo "Auth Emulator: ${FIREBASE_AUTH_EMULATOR_HOST}"
echo "Firestore Emulator: ${FIRESTORE_EMULATOR_HOST}"
echo "Storage Emulator: ${STORAGE_EMULATOR_HOST}"
echo "Project ID: ${GCP_PROJECT_ID}"
echo "=========================="
echo ""

# --- Type-specific setup ---
case "$APP_TYPE" in
  firebase)
    # Static Firebase app with Firebase emulators

    # Build the site BEFORE starting emulators to prevent 404 caching
    # The hosting emulator caches 404 responses for files missing at startup.
    # These cached 404s persist even if files are added later, causing tests to fail.
    # Building first ensures all files exist before the emulator starts caching.
    echo "Building..."

    # Set VITE_FIREBASE_* vars for Vite apps to exercise production code paths
    # Apps with .env.example use these vars for Firebase SDK initialization
    # Values don't matter for emulator connectivity (handled by VITE_USE_FIREBASE_EMULATOR=true)
    # They just need to pass isFirebaseConfigured() validation (non-empty, no "your-" prefix)
    if [ -f "${APP_PATH_ABS}/site/.env.example" ]; then
      export VITE_FIREBASE_API_KEY="emulator-api-key"
      export VITE_FIREBASE_AUTH_DOMAIN="${GCP_PROJECT_ID}.firebaseapp.com"
      export VITE_FIREBASE_PROJECT_ID="${GCP_PROJECT_ID}"
      export VITE_FIREBASE_STORAGE_BUCKET="${GCP_PROJECT_ID}.appspot.com"
      export VITE_FIREBASE_MESSAGING_SENDER_ID="000000000000"
      export VITE_FIREBASE_APP_ID="1:000000000000:web:0000000000000000000000"
    fi

    VITE_USE_FIREBASE_EMULATOR=true VITE_GCP_PROJECT_ID="${GCP_PROJECT_ID}" pnpm --dir "${APP_PATH_ABS}/site" build

    if [ "$REUSE_EMULATORS" = "true" ]; then
      echo "✓ Skipping emulator startup - reusing existing emulators"
    else
      # Start emulators under supervision if not already running
      if ! is_supervisor_running; then
        echo "🚀 Starting emulators with supervisor..."
        mkdir -p "${ROOT_DIR}/tmp"
        "$SCRIPT_DIR/emulator-supervisor.sh" "$APP_NAME" > "${ROOT_DIR}/tmp/supervisor.log" 2>&1 &

        # Wait for emulators to be ready
        echo "⏳ Waiting for emulators to start..."
        max_wait=120
        waited=0
        AUTH_PORT_EXPECTED="${FIREBASE_AUTH_EMULATOR_HOST##*:}"
        HOSTING_PORT_EXPECTED="${HOSTING_PORT}"
        while [[ $waited -lt $max_wait ]]; do
          if nc -z 127.0.0.1 ${AUTH_PORT_EXPECTED} 2>/dev/null && nc -z 127.0.0.1 ${HOSTING_PORT_EXPECTED} 2>/dev/null; then
            break
          fi
          sleep 2
          waited=$((waited + 2))
        done

        if [[ $waited -ge $max_wait ]]; then
          echo "ERROR: Emulators failed to start within ${max_wait}s"
          cat "${ROOT_DIR}/tmp/supervisor.log" 2>/dev/null || true
          exit 1
        fi
        echo "✓ Emulators ready under supervision"
      else
        echo "ℹ️  Using existing supervised emulators"

        # Ensure hosting emulator is running for this worktree
        # Problem: When supervisor manages emulators in another worktree, this worktree's
        # hosting emulator may not be running, causing E2E tests to fail with connection errors.
        # Solution: Independently start hosting emulator if not detected on expected port.
        # Testing: Missing - tracked in #1714
        echo "🔍 Verifying hosting emulator for this worktree..."
        echo "   Expected hosting port: ${HOSTING_PORT}"

        if ! nc -z 127.0.0.1 "${HOSTING_PORT}" 2>/dev/null; then
          echo "⚠️  Hosting emulator not running on port ${HOSTING_PORT}"
          echo "🚀 Starting hosting emulator independently for this worktree..."

          # Start hosting emulator in background
          mkdir -p "${ROOT_DIR}/tmp/infrastructure"
          HOSTING_LOG="${ROOT_DIR}/tmp/infrastructure/firebase-hosting-${GCP_PROJECT_ID}.log"
          TEMP_CONFIG="${ROOT_DIR}/.firebase-${GCP_PROJECT_ID}.json"

          # Use shared function from port-utils.sh to get Firebase site ID
          SITE_ID=$(get_firebase_site_id "$APP_NAME")

          # Validate firebase.json exists and is valid JSON before processing
          if [ ! -f "${ROOT_DIR}/firebase.json" ]; then
            echo "ERROR: firebase.json not found in repository root" >&2
            echo "Expected at: ${ROOT_DIR}/firebase.json" >&2
            exit 1
          fi

          if ! jq empty "${ROOT_DIR}/firebase.json" 2>/dev/null; then
            echo "ERROR: firebase.json contains invalid JSON syntax" >&2
            echo "" >&2
            echo "Check syntax with: jq . ${ROOT_DIR}/firebase.json" >&2
            exit 1
          fi

          # Extract single site config without site/target fields to prevent multi-target port allocation
          # When site/target fields are present, Firebase attempts to serve all targets simultaneously,
          # causing port conflicts with our single-port-per-instance setup (HOSTING_PORT=${HOSTING_PORT})
          JQ_ERROR=$(mktemp)
          HOSTING_CONFIG=$(jq --arg site "$SITE_ID" \
            '.hosting[] | select(.site == $site) | del(.site, .target)' \
            "${ROOT_DIR}/firebase.json" 2>"$JQ_ERROR")
          JQ_EXIT=$?

          if [ $JQ_EXIT -ne 0 ]; then
            echo "ERROR: jq command failed while processing firebase.json" >&2
            echo "jq exit code: $JQ_EXIT" >&2
            if [ -s "$JQ_ERROR" ]; then
              echo "" >&2
              echo "jq error output:" >&2
              cat "$JQ_ERROR" | sed 's/^/  /' >&2
            fi
            rm -f "$JQ_ERROR"
            echo "" >&2
            echo "This usually indicates:" >&2
            echo "  - jq is not installed: Install with 'apt install jq' or 'brew install jq'" >&2
            echo "  - Unexpected firebase.json structure" >&2
            exit 1
          fi
          rm -f "$JQ_ERROR"

          if [ -z "$HOSTING_CONFIG" ] || [ "$HOSTING_CONFIG" = "null" ]; then
            echo "ERROR: No hosting config found for site '$SITE_ID' (app: '$APP_NAME') in firebase.json" >&2
            echo "" >&2
            AVAILABLE_SITES=$(jq -r '.hosting[].site // empty' "${ROOT_DIR}/firebase.json" 2>/dev/null)
            if [ -n "$AVAILABLE_SITES" ]; then
              echo "Available sites:" >&2
              echo "$AVAILABLE_SITES" | sed 's/^/  - /' >&2
            else
              echo "No sites found in firebase.json hosting array" >&2
            fi
            exit 1
          fi

          # Create temporary firebase config with only this app's hosting config
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

          echo "   Created temporary config: ${TEMP_CONFIG}"
          echo "   Hosting site: $SITE_ID (app: $APP_NAME) on port ${HOSTING_PORT}"

          firebase emulators:start \
            --only hosting \
            --project "${GCP_PROJECT_ID}" \
            --config "${TEMP_CONFIG}" \
            > "$HOSTING_LOG" 2>&1 &

          HOSTING_PID=$!
          echo "   Hosting emulator started (PID: $HOSTING_PID)"

          # Wait for hosting to be ready
          echo "⏳ Waiting for hosting emulator to start on port ${HOSTING_PORT}..."
          max_wait=30
          waited=0
          while [[ $waited -lt $max_wait ]]; do
            if nc -z 127.0.0.1 "${HOSTING_PORT}" 2>/dev/null; then
              echo "✓ Hosting emulator ready on port ${HOSTING_PORT}"
              break
            fi
            sleep 1
            waited=$((waited + 1))
          done

          if [[ $waited -ge $max_wait ]]; then
            echo "ERROR: Hosting emulator failed to start within ${max_wait}s"
            echo "Log output:"
            cat "$HOSTING_LOG" 2>/dev/null || true
            # Clean up temp config on failure
            rm -f "${TEMP_CONFIG}"
            exit 1
          fi

          # Set up cleanup for independently-started hosting emulator
          cleanup_independent_hosting() {
            if [ -n "${HOSTING_PID:-}" ] && kill -0 "$HOSTING_PID" 2>/dev/null; then
              kill -TERM "$HOSTING_PID" 2>/dev/null || true
              sleep 1
              kill -0 "$HOSTING_PID" 2>/dev/null && kill -KILL "$HOSTING_PID" 2>/dev/null || true
            fi
            rm -f "${TEMP_CONFIG:-}" 2>/dev/null || true
          }
          add_cleanup_handler cleanup_independent_hosting
        else
          echo "✓ Hosting emulator already running on port ${HOSTING_PORT}"
        fi
      fi
    fi

    # Export emulator env vars
    export FIRESTORE_EMULATOR_HOST
    export STORAGE_EMULATOR_HOST
    export FIREBASE_AUTH_EMULATOR_HOST
    export GCP_PROJECT_ID

    # Debug: Verify emulator environment
    echo "=== CI Debug: Emulator Environment ==="
    echo "FIRESTORE_EMULATOR_HOST: $FIRESTORE_EMULATOR_HOST"
    echo "FIREBASE_AUTH_EMULATOR_HOST: $FIREBASE_AUTH_EMULATOR_HOST"
    echo "STORAGE_EMULATOR_HOST: $STORAGE_EMULATOR_HOST"
    echo "GCP_PROJECT_ID: $GCP_PROJECT_ID"
    echo "CI environment: ${CI:-false}"
    echo "======================================"

    # Debug: Check if cards.json exists (for fellspiral tests)
    CARDS_JSON="${APP_PATH_ABS}/site/src/data/cards.json"
    if [ -f "$CARDS_JSON" ]; then
      CARD_COUNT=$(jq '. | length' "$CARDS_JSON" 2>/dev/null || echo "unknown")
      echo "=== CI Debug: Test Data ==="
      echo "cards.json found at: $CARDS_JSON"
      echo "Card count: $CARD_COUNT"
      echo "==========================="
    fi

    # Export test environment configuration to JSON for type-safe access
    # This provides a single source of truth and eliminates env var propagation issues
    TEST_ENV_CONFIG="${ROOT_DIR}/.test-env.json"
    TIMEOUT_MULTIPLIER="${TIMEOUT_MULTIPLIER:-1}"
    DEPLOYED_URL="${DEPLOYED_URL:-}"

    # Pre-config health check: Verify hosting emulator is actually running
    # This prevents writing .test-env.json with a port that has no running server
    echo ""
    echo "=== Pre-Config Verification ==="
    echo "Verifying hosting emulator on port ${HOSTING_PORT}..."
    if ! nc -z 127.0.0.1 "${HOSTING_PORT}" 2>/dev/null; then
      echo "ERROR: Hosting emulator is not running on port ${HOSTING_PORT}"
      echo "This should not happen - emulator startup logic has failed"
      echo ""
      echo "Debug information:"
      echo "  HOSTING_PORT: ${HOSTING_PORT}"
      echo "  GCP_PROJECT_ID: ${GCP_PROJECT_ID}"
      echo "  REUSE_EMULATORS: ${REUSE_EMULATORS}"
      echo ""
      echo "Check logs at: ${ROOT_DIR}/tmp/infrastructure/firebase-hosting-${GCP_PROJECT_ID}.log"
      exit 1
    fi
    echo "✓ Hosting emulator verified on port ${HOSTING_PORT}"
    echo "==============================="
    echo ""

    cat > "$TEST_ENV_CONFIG" << EOF
{
  "mode": "${DEPLOYED_URL:+deployed}${DEPLOYED_URL:-emulator}",
  "isCI": ${CI:-false},
  "emulators": {
    "projectId": "${GCP_PROJECT_ID}",
    "firestoreHost": "${FIRESTORE_EMULATOR_HOST}",
    "authHost": "${FIREBASE_AUTH_EMULATOR_HOST}",
    "storageHost": "${STORAGE_EMULATOR_HOST}",
    "hostingPort": ${HOSTING_PORT},
    "appName": "${APP_NAME}"
  },
  "timeouts": {
    "test": $((60 * TIMEOUT_MULTIPLIER)),
    "emulatorStartup": $((120 * TIMEOUT_MULTIPLIER)),
    "multiplier": ${TIMEOUT_MULTIPLIER}
  }$([ -n "${DEPLOYED_URL}" ] && echo ",
  \"deployedUrl\": \"${DEPLOYED_URL}\"" || echo "")
}
EOF

    # Sanity check: Verify the written config matches our shell variables
    # This catches JSON generation errors, variable substitution failures, or file corruption
    # Should never fail in normal operation - indicates a serious infrastructure bug if it does
    WRITTEN_PORT=$(jq -r '.emulators.hostingPort' "$TEST_ENV_CONFIG")
    if [ "$WRITTEN_PORT" != "$HOSTING_PORT" ]; then
      echo "ERROR: Config mismatch - HOSTING_PORT=${HOSTING_PORT} but .test-env.json has ${WRITTEN_PORT}" >&2
      exit 1
    fi

    echo "=== Test Environment Config ==="
    echo "Config exported to: $TEST_ENV_CONFIG"
    cat "$TEST_ENV_CONFIG"
    echo "================================"

    # Set up cleanup handler (only when we started the emulators AND supervisor is NOT managing them)
    if [ "$REUSE_EMULATORS" = "false" ] && ! is_supervisor_running; then
      cleanup() {
        echo "Stopping emulators..."
        "${ROOT_DIR}/infrastructure/scripts/stop-emulators.sh" || true

        # Kill any orphaned Playwright/test processes
        pkill -f "npx playwright test" 2>/dev/null || true
        pkill -f "firefox.*headless" 2>/dev/null || true
        pkill -f "chromium.*headless" 2>/dev/null || true

        # Kill zombie node processes
        ps aux | grep -E "defunct|<defunct>" | grep -E "node|playwright|firefox|chromium" | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
      }
      add_cleanup_handler cleanup
    else
      echo "ℹ️  Emulators managed by supervisor - no cleanup on exit"
    fi
    ;;

  go-fullstack)
    # Go app with Firebase backend emulators (no hosting emulator)
    # These apps serve via their own web server (started by Playwright webServer config)
    # They only need backend emulators: Auth, Firestore, Storage
    if [ "$REUSE_EMULATORS" = "true" ]; then
      echo "✓ Skipping emulator startup - reusing existing backend emulators"
    else
      # Start backend emulators under supervision if not already running
      if ! is_supervisor_running; then
        echo "🚀 Starting backend emulators with supervisor..."
        mkdir -p "${ROOT_DIR}/tmp"
        SKIP_HOSTING=1 "$SCRIPT_DIR/emulator-supervisor.sh" > "${ROOT_DIR}/tmp/supervisor.log" 2>&1 &

        # Wait for backend emulators to be ready
        echo "⏳ Waiting for backend emulators to start..."
        max_wait=120
        waited=0
        AUTH_PORT_EXPECTED="${FIREBASE_AUTH_EMULATOR_HOST##*:}"
        FIRESTORE_PORT_EXPECTED="${FIRESTORE_EMULATOR_HOST##*:}"
        while [[ $waited -lt $max_wait ]]; do
          if nc -z 127.0.0.1 ${AUTH_PORT_EXPECTED} 2>/dev/null && nc -z 127.0.0.1 ${FIRESTORE_PORT_EXPECTED} 2>/dev/null; then
            break
          fi
          sleep 2
          waited=$((waited + 2))
        done

        if [[ $waited -ge $max_wait ]]; then
          echo "ERROR: Backend emulators failed to start within ${max_wait}s"
          cat "${ROOT_DIR}/tmp/supervisor.log" 2>/dev/null || true
          exit 1
        fi
        echo "✓ Backend emulators ready under supervision"
      else
        echo "ℹ️  Using existing supervised backend emulators"
      fi
    fi

    # Export emulator env vars
    export FIRESTORE_EMULATOR_HOST
    export STORAGE_EMULATOR_HOST
    export FIREBASE_AUTH_EMULATOR_HOST
    export GCP_PROJECT_ID

    # Set up cleanup handler (only when we started the emulators AND supervisor is NOT managing them)
    if [ "$REUSE_EMULATORS" = "false" ] && ! is_supervisor_running; then
      cleanup_backend() {
        echo "Stopping emulators..."
        "${ROOT_DIR}/infrastructure/scripts/stop-emulators.sh" || true
      }
      add_cleanup_handler cleanup_backend
    else
      echo "ℹ️  Backend emulators managed by supervisor - no cleanup on exit"
    fi

    echo "Building..."
    (cd "${APP_PATH_ABS}/site" && make build)
    ;;

  go-tui)
    # Go TUI app
    echo "Building..."
    (cd "${APP_PATH_ABS}" && make build)
    ;;

  *)
    echo "Unknown app type: $APP_TYPE"
    exit 1
    ;;
esac

# --- Health check emulators (firebase and go-fullstack only) ---
if [ "$APP_TYPE" = "firebase" ] || [ "$APP_TYPE" = "go-fullstack" ]; then
  # Extract port numbers from emulator host strings
  AUTH_PORT="${FIREBASE_AUTH_EMULATOR_HOST##*:}"
  FIRESTORE_PORT="${FIRESTORE_EMULATOR_HOST##*:}"

  echo ""
  echo "=== Emulator Health Check ==="

  # CI Debug: Show emulator log for rules loading info
  if [ "${CI:-false}" = "true" ]; then
    echo "=== CI Debug: Backend Emulator Log (rules-related) ==="
    grep -i "rules\|config\|loading\|firestore" ~/.firebase-emulators/firebase-backend-emulators.log 2>/dev/null | head -20 || echo "  (no rules info in log)"
    echo "======================================="
    echo ""
  fi

  if ! check_emulator_health "127.0.0.1" "${AUTH_PORT}" "127.0.0.1" "${FIRESTORE_PORT}" "${GCP_PROJECT_ID}"; then
    echo ""
    echo "⚠️  Emulator health check failed. Restarting emulators..."

    # Stop emulators
    "${ROOT_DIR}/infrastructure/scripts/stop-emulators.sh"

    # Kill backend emulators if needed
    if [[ -f ~/.firebase-emulators/firebase-backend-emulators.pid ]]; then
      backend_pid=$(cat ~/.firebase-emulators/firebase-backend-emulators.pid)
      if kill -0 "$backend_pid" 2>/dev/null; then
        echo "Killing backend emulators (PID: $backend_pid)..."
        kill "$backend_pid"
        rm -f ~/.firebase-emulators/firebase-backend-emulators.pid
      fi
    fi

    # Clear lock to allow restart
    if [[ -d ~/.firebase-emulators/lock ]]; then
      echo "Removing stale lock..."
      rm -rf ~/.firebase-emulators/lock
    fi

    # Wait for ports to be released
    sleep 2

    # Restart emulators based on app type
    echo "Restarting emulators..."
    if [ "$APP_TYPE" = "firebase" ]; then
      source "${ROOT_DIR}/infrastructure/scripts/start-emulators.sh" "$APP_NAME"
    else
      # go-fullstack: backend only
      SKIP_HOSTING=1 source "${ROOT_DIR}/infrastructure/scripts/start-emulators.sh"
    fi

    # Retry health check
    echo ""
    echo "=== Retry Health Check After Restart ==="
    if ! check_emulator_health "127.0.0.1" "${AUTH_PORT}" "127.0.0.1" "${FIRESTORE_PORT}" "${GCP_PROJECT_ID}"; then
      echo ""
      echo "ERROR: Emulators still unhealthy after restart"
      echo "Please check emulator logs at:"
      echo "  Backend: ~/.firebase-emulators/firebase-backend-emulators.log"
      if [ "$APP_TYPE" = "firebase" ]; then
        echo "  Hosting: tmp/infrastructure/firebase-hosting-${GCP_PROJECT_ID}.log"
      fi
      exit 1
    fi

    echo "✅ Emulators healthy after restart"
  fi
  echo "================================"
  echo ""
fi

# --- Seed emulator (for apps that need demo data) ---
if [ "$APP_TYPE" = "firebase" ] && [ "$APP_NAME" = "budget" ]; then
  echo ""
  echo "=== Seeding Budget Demo Data ==="
  cd "${APP_PATH_ABS}/site"

  # Run seeding script (uses FIRESTORE_EMULATOR_HOST from environment)
  if [ -f "scripts/seed-local.sh" ]; then
    bash scripts/seed-local.sh || {
      echo "ERROR: Failed to seed demo data" >&2
      exit 1
    }
    echo "✓ Demo data seeded successfully"
  else
    echo "WARNING: No seed-local.sh script found, skipping seeding"
  fi
  echo "================================"
  echo ""
fi

# --- Run tests ---
cd "${APP_PATH_ABS}"

if [ "$APP_TYPE" = "firebase" ]; then
  # Firebase apps use Playwright
  echo "Running Playwright tests..."

  # Diagnostic: Verify rules files before running tests
  if [ "${CI:-false}" = "true" ]; then
    echo ""
    echo "=== CI Debug: Rules Files Before E2E ==="
    echo "fellspiral/firestore.rules:"
    wc -l "${ROOT_DIR}/fellspiral/firestore.rules" 2>/dev/null || echo "  NOT FOUND"
    echo ".firebase/firestore.rules:"
    wc -l "${ROOT_DIR}/.firebase/firestore.rules" 2>/dev/null || echo "  NOT FOUND"
    echo "fellspiral/firestore.rules.source:"
    wc -l "${ROOT_DIR}/fellspiral/firestore.rules.source" 2>/dev/null || echo "  NOT FOUND"
    echo "======================================="
    echo ""
  fi

  cd "${APP_PATH_ABS}/tests"

  # Set START_SERVER=true to serve built files (we built above with pnpm build)
  # Let playwright.config.ts determine browser based on platform
  # No hardcoded --project chromium
  # Explicitly pass environment variables to Playwright subprocess

  # Build Playwright command with optional shard parameter
  PLAYWRIGHT_CMD="npx playwright test"
  if [ -n "${PLAYWRIGHT_SHARD:-}" ]; then
    echo "Running shard: ${PLAYWRIGHT_SHARD}"
    PLAYWRIGHT_CMD="$PLAYWRIGHT_CMD --shard=${PLAYWRIGHT_SHARD}"
  fi

  START_SERVER=true HOSTING_PORT="${HOSTING_PORT}" PORT="${PORT}" GCP_PROJECT_ID="${GCP_PROJECT_ID}" \
    FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST}" \
    FIREBASE_AUTH_EMULATOR_HOST="${FIREBASE_AUTH_EMULATOR_HOST}" \
    STORAGE_EMULATOR_HOST="${STORAGE_EMULATOR_HOST}" \
    $PLAYWRIGHT_CMD

elif [ "$APP_TYPE" = "go-tui" ] || [ "$APP_TYPE" = "go-fullstack" ]; then
  # Go apps use make test-e2e
  echo "Running Go E2E tests..."
  make test-e2e
fi

echo "Tests passed: $APP_NAME"
