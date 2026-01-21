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
# SUPERVISOR DETECTION: Check if supervisor is managing emulators
# ============================================================================
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

if [ "$REUSE_EMULATORS" = "false" ]; then
  # Allocate ports based on worktree (normal path)
  source "$SCRIPT_DIR/allocate-test-ports.sh" || {
    echo "FATAL: Port allocation failed" >&2
    echo "This could be due to:" >&2
    echo "  - Missing allocate-test-ports.sh file" >&2
    echo "  - Port allocation failure (all ports in use)" >&2
    echo "  - Invalid port configuration" >&2
    echo "Check allocate-test-ports.sh output above for details" >&2
    exit 1
  }

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
    exit 1
  fi
else
  # INFRASTRUCTURE STABILITY FIX: Clear Firestore data when reusing emulators
  # This ensures test isolation and prevents stale data from affecting tests
  FIRESTORE_PORT="${FIRESTORE_EMULATOR_HOST##*:}"
  FIRESTORE_HOST="${FIRESTORE_EMULATOR_HOST%%:*}"

  echo ""
  echo "=== Clearing Firestore Data (Reused Emulators) ==="
  clear_firestore_data "$FIRESTORE_HOST" "$FIRESTORE_PORT" "$GCP_PROJECT_ID" || {
    echo "⚠️  Data clearing failed, but continuing with tests..." >&2
  }
  echo "===================================================="
  echo ""
fi

echo "Using ports: App=${TEST_PORT:-$HOSTING_PORT}, Auth=${FIREBASE_AUTH_EMULATOR_HOST}, Firestore=${FIRESTORE_EMULATOR_HOST}, Storage=${STORAGE_EMULATOR_HOST}"

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
