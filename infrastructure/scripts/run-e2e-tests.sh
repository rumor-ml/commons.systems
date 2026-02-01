#!/usr/bin/env bash
# Universal E2E test runner
# Usage: run-e2e-tests.sh <app-type> <app-path>
#
# App types: firebase, go-fullstack, go-tui
# Handles: CWD setup, ENV vars, emulators, platform detection

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

# Source port utilities for sandbox detection
source "$SCRIPT_DIR/port-utils.sh"

# Check sandbox requirement BEFORE any emulator operations
check_sandbox_requirement "Running E2E tests with Firebase emulators" || exit 1

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
  if POOL_INSTANCE_JSON=$(source "$EMULATOR_POOL_SCRIPT" claim 2>/dev/null); then
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

    # Set up cleanup trap to release instance on exit
    release_pool_instance() {
      if [ "$POOL_INSTANCE_CLAIMED" = "true" ] && [ -n "$POOL_INSTANCE_ID" ]; then
        echo "Releasing pool instance: $POOL_INSTANCE_ID"
        source "$EMULATOR_POOL_SCRIPT" release "$POOL_INSTANCE_ID" 2>/dev/null || true
      fi
    }
    trap release_pool_instance EXIT
  else
    echo "⚠️  No available pool instances - falling back to singleton mode"
  fi
else
  echo "⚠️  Emulator pool not initialized - using singleton mode"
fi

echo "=================================================="
echo ""

# ============================================================================
# SUPERVISOR DETECTION: Check if supervisor is managing emulators
# ============================================================================
# TODO(#1714): Add tests for supervisor detection and multi-worktree hosting startup
SUPERVISOR_PID_FILE="$HOME/.firebase-emulators/supervisor.pid"

# Check if supervisor is already running
is_supervisor_running() {
  if [[ -f "$SUPERVISOR_PID_FILE" ]]; then
    local pid
    pid=$(cat "$SUPERVISOR_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo "✓ Supervisor already running (PID: $pid)"
      return 0
    fi
    rm -f "$SUPERVISOR_PID_FILE"
  fi
  return 1
}

# ============================================================================
# EMULATOR REUSE: Check if emulators are already running before allocation
# ============================================================================
# If .test-env.json exists and emulators are healthy, reuse them instead of
# starting new ones. This prevents port exhaustion when dev server is running.
# TODO(#1713): Add tests for emulator reuse logic

TEST_ENV_CONFIG="${ROOT_DIR}/.test-env.json"
REUSE_EMULATORS=false

if [ -f "$TEST_ENV_CONFIG" ]; then
  # Extract ports from existing config
  EXISTING_AUTH_HOST=$(jq -r '.emulators.authHost // empty' "$TEST_ENV_CONFIG" 2>/dev/null)
  EXISTING_FIRESTORE_HOST=$(jq -r '.emulators.firestoreHost // empty' "$TEST_ENV_CONFIG" 2>/dev/null)
  EXISTING_HOSTING_PORT=$(jq -r '.emulators.hostingPort // empty' "$TEST_ENV_CONFIG" 2>/dev/null)
  EXISTING_PROJECT_ID=$(jq -r '.emulators.projectId // empty' "$TEST_ENV_CONFIG" 2>/dev/null)

  if [ -n "$EXISTING_AUTH_HOST" ] && [ -n "$EXISTING_HOSTING_PORT" ]; then
    # Extract port numbers from host strings
    AUTH_PORT_CHECK="${EXISTING_AUTH_HOST##*:}"
    HOSTING_PORT_CHECK="$EXISTING_HOSTING_PORT"

    # Check if both Auth emulator and Hosting emulator are running
    if nc -z 127.0.0.1 "$AUTH_PORT_CHECK" 2>/dev/null && \
       nc -z 127.0.0.1 "$HOSTING_PORT_CHECK" 2>/dev/null; then
      echo "✓ Detected running emulators - reusing existing configuration"
      echo "  Auth: $EXISTING_AUTH_HOST"
      echo "  Hosting: localhost:$EXISTING_HOSTING_PORT"
      echo "  Project: $EXISTING_PROJECT_ID"
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

if [ "$REUSE_EMULATORS" = "false" ] && [ "$POOL_INSTANCE_CLAIMED" = "false" ]; then
  # Allocate ports based on worktree (singleton mode)
  echo "=== Allocating ports for singleton mode ==="

  # Capture stderr from allocate-test-ports.sh for better diagnostics
  ALLOC_ERROR=$(mktemp)
  if ! source "$SCRIPT_DIR/allocate-test-ports.sh" 2>"$ALLOC_ERROR"; then
    echo "FATAL: Port allocation failed" >&2
    echo "" >&2
    if [ -s "$ALLOC_ERROR" ]; then
      echo "Error output from allocate-test-ports.sh:" >&2
      cat "$ALLOC_ERROR" | sed 's/^/  /' >&2
      echo "" >&2
    fi
    rm -f "$ALLOC_ERROR"
    echo "This could be due to:" >&2
    echo "  - All ports in range 5000-5999 are in use" >&2
    echo "  - allocate-test-ports.sh missing or not executable" >&2
    echo "  - Insufficient permissions" >&2
    echo "" >&2
    echo "Try: infrastructure/scripts/stop-emulators.sh --force-backend" >&2
    exit 1
  fi
  rm -f "$ALLOC_ERROR"

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
  # INFRASTRUCTURE STABILITY FIX: Clear Firestore data when reusing emulators
  # This ensures test isolation and prevents stale data from affecting tests
  FIRESTORE_PORT="${FIRESTORE_EMULATOR_HOST##*:}"
  FIRESTORE_HOST="${FIRESTORE_EMULATOR_HOST%%:*}"

  echo ""
  echo "=== Clearing Firestore Data (Reused Emulators) ==="
  CLEAR_ERROR=$(mktemp)
  if ! clear_firestore_data "$FIRESTORE_HOST" "$FIRESTORE_PORT" "$GCP_PROJECT_ID" 2>"$CLEAR_ERROR"; then
    echo "⚠️  Firestore data clearing failed" >&2
    echo "" >&2
    if [ -s "$CLEAR_ERROR" ]; then
      echo "Error details:" >&2
      cat "$CLEAR_ERROR" | sed 's/^/  /' >&2
      echo "" >&2
    fi
    rm -f "$CLEAR_ERROR"
    echo "This may cause test flakiness due to stale data from previous runs" >&2
    echo "" >&2
    echo "Recovery options:" >&2
    echo "  1. Restart emulators: infrastructure/scripts/stop-emulators.sh && infrastructure/scripts/start-emulators.sh" >&2
    echo "  2. Continue anyway (tests may be flaky): Press Ctrl+C to abort or wait 5s to continue" >&2
    sleep 5
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
    # The hosting emulator caches 404 responses for missing files during startup.
    # Building first ensures files exist when emulator initializes, preventing cached 404s.
    echo "Building..."
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

        # CRITICAL FIX: Ensure hosting emulator is running for this worktree
        # Problem: When supervisor manages emulators in another worktree, this worktree's
        # hosting emulator may not be running, causing E2E tests to fail with connection errors.
        # Solution: Independently start hosting emulator if not detected on expected port.
        # Related: commit e927b42 "Fix hosting emulator startup when supervisor runs in other worktrees"
        echo "🔍 Verifying hosting emulator for this worktree..."
        echo "   Expected hosting port: ${HOSTING_PORT}"

        if ! nc -z 127.0.0.1 "${HOSTING_PORT}" 2>/dev/null; then
          echo "⚠️  Hosting emulator not running on port ${HOSTING_PORT}"
          echo "🚀 Starting hosting emulator independently for this worktree..."

          # Start hosting emulator in background
          mkdir -p "${ROOT_DIR}/tmp/infrastructure"
          HOSTING_LOG="${ROOT_DIR}/tmp/infrastructure/firebase-hosting-${GCP_PROJECT_ID}.log"
          TEMP_CONFIG="${ROOT_DIR}/.firebase-${GCP_PROJECT_ID}.json"

          # Map app name to Firebase site ID (must match firebase.json hosting.site values)
          get_firebase_site_id() {
            local app_name="$1"
            case "$app_name" in
              videobrowser) echo "videobrowser-7696a" ;;
              print) echo "print-dfb47" ;;
              budget) echo "budget-81cb7" ;;
              fellspiral) echo "fellspiral" ;;
              audiobrowser) echo "audiobrowser" ;;
              *) echo "$app_name" ;;  # Default: use app name as-is
            esac
          }

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

          # Extract the one site config and remove site/target fields
          # This avoids port conflicts when firebase.json has multiple hosting targets
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
            echo "Cleaning up independently-started hosting emulator..."

            if [ -n "${HOSTING_PID:-}" ]; then
              if kill -0 "$HOSTING_PID" 2>/dev/null; then
                echo "  Stopping hosting emulator (PID: $HOSTING_PID)..."
                if kill -TERM "$HOSTING_PID" 2>/dev/null; then
                  sleep 1
                  # Check if still running
                  if kill -0 "$HOSTING_PID" 2>/dev/null; then
                    echo "  Process didn't exit, sending SIGKILL..."
                    kill -KILL "$HOSTING_PID" 2>/dev/null || echo "  WARNING: Failed to SIGKILL $HOSTING_PID" >&2
                  fi
                  echo "  ✓ Hosting emulator stopped"
                else
                  echo "  WARNING: Failed to send SIGTERM to $HOSTING_PID (may have already exited)" >&2
                fi
              else
                echo "  ℹ️  Hosting emulator already exited (PID: $HOSTING_PID)"
              fi
            else
              echo "  ℹ️  No HOSTING_PID set, skipping process cleanup"
            fi

            # Clean up temp config
            if [ -n "${TEMP_CONFIG:-}" ] && [ -f "$TEMP_CONFIG" ]; then
              if rm -f "$TEMP_CONFIG" 2>/dev/null; then
                echo "  ✓ Removed temp config: $TEMP_CONFIG"
              else
                echo "  WARNING: Failed to remove temp config: $TEMP_CONFIG" >&2
              fi
            fi
          }
          trap cleanup_independent_hosting EXIT
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

    # CRITICAL VERIFICATION: Ensure hosting emulator is actually running before writing config
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
    "hostingPort": ${HOSTING_PORT}
  },
  "timeouts": {
    "test": $((60 * TIMEOUT_MULTIPLIER)),
    "emulatorStartup": $((120 * TIMEOUT_MULTIPLIER)),
    "multiplier": ${TIMEOUT_MULTIPLIER}
  }$([ -n "${DEPLOYED_URL}" ] && echo ",
  \"deployedUrl\": \"${DEPLOYED_URL}\"" || echo "")
}
EOF

    echo "=== Test Environment Config ==="
    echo "Config exported to: $TEST_ENV_CONFIG"
    cat "$TEST_ENV_CONFIG"
    echo "================================"

    # Set up cleanup trap (only when we started the emulators AND supervisor is NOT managing them)
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
      trap cleanup EXIT
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

    # Set up cleanup trap (only when we started the emulators AND supervisor is NOT managing them)
    if [ "$REUSE_EMULATORS" = "false" ] && ! is_supervisor_running; then
      cleanup() {
        echo "Stopping emulators..."
        "${ROOT_DIR}/infrastructure/scripts/stop-emulators.sh" || true
      }
      trap cleanup EXIT
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

# --- Run tests ---
cd "${APP_PATH_ABS}"

if [ "$APP_TYPE" = "firebase" ]; then
  # Firebase apps use Playwright
  echo "Running Playwright tests..."
  cd "${APP_PATH_ABS}/tests"

  # Set START_SERVER=true to serve built files (we built above with pnpm build)
  # Let playwright.config.ts determine browser based on platform
  # No hardcoded --project chromium
  # Explicitly pass environment variables to Playwright subprocess
  START_SERVER=true HOSTING_PORT="${HOSTING_PORT}" PORT="${PORT}" GCP_PROJECT_ID="${GCP_PROJECT_ID}" \
    FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST}" \
    FIREBASE_AUTH_EMULATOR_HOST="${FIREBASE_AUTH_EMULATOR_HOST}" \
    STORAGE_EMULATOR_HOST="${STORAGE_EMULATOR_HOST}" \
    npx playwright test

elif [ "$APP_TYPE" = "go-tui" ] || [ "$APP_TYPE" = "go-fullstack" ]; then
  # Go apps use make test-e2e
  echo "Running Go E2E tests..."
  make test-e2e
fi

echo "Tests passed: $APP_NAME"
