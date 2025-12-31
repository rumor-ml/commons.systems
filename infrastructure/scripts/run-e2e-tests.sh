#!/bin/bash
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

# Allocate ports based on worktree
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

echo "Using ports: App=$TEST_PORT, Auth=${FIREBASE_AUTH_EMULATOR_HOST}, Firestore=${FIRESTORE_EMULATOR_HOST}, Storage=${STORAGE_EMULATOR_HOST}"

# --- Type-specific setup ---
case "$APP_TYPE" in
  firebase)
    # Static Firebase app with Firebase emulators

    # Build the site BEFORE starting emulators to prevent 404 caching
    # The hosting emulator caches 404 responses for missing files during startup.
    # Building first ensures files exist when emulator initializes, preventing cached 404s.
    echo "Building..."
    pnpm --dir "${APP_PATH_ABS}/site" build

    echo "Starting Firebase emulators..."
    source "${ROOT_DIR}/infrastructure/scripts/start-emulators.sh" "$APP_NAME"

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

    # Set up cleanup trap
    cleanup() {
      echo "Stopping emulators..."
      "${ROOT_DIR}/infrastructure/scripts/stop-emulators.sh" || true
    }
    trap cleanup EXIT
    ;;

  go-fullstack)
    # Go app with Firebase backend emulators (no hosting emulator)
    # These apps serve via their own web server (started by Playwright webServer config)
    # They only need backend emulators: Auth, Firestore, Storage
    echo "Starting Firebase backend emulators..."
    source "${ROOT_DIR}/infrastructure/scripts/start-emulators.sh"

    # Export emulator env vars
    export FIRESTORE_EMULATOR_HOST
    export STORAGE_EMULATOR_HOST
    export FIREBASE_AUTH_EMULATOR_HOST
    export GCP_PROJECT_ID

    # Set up cleanup trap
    cleanup() {
      echo "Stopping emulators..."
      "${ROOT_DIR}/infrastructure/scripts/stop-emulators.sh" || true
    }
    trap cleanup EXIT

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

# --- Run tests ---
cd "${APP_PATH_ABS}"

if [ "$APP_TYPE" = "firebase" ]; then
  # Firebase apps use Playwright
  echo "Running Playwright tests..."
  cd "${APP_PATH_ABS}/tests"

  # Let playwright.config.ts determine browser based on platform
  # No hardcoded --project chromium
  # Explicitly pass environment variables to Playwright subprocess
  HOSTING_PORT="${HOSTING_PORT}" PORT="${PORT}" GCP_PROJECT_ID="${GCP_PROJECT_ID}" \
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
