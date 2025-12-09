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
source "$SCRIPT_DIR/allocate-test-ports.sh"

echo "Using ports: App=$TEST_PORT, Auth=${FIREBASE_AUTH_EMULATOR_HOST}, Firestore=${FIRESTORE_EMULATOR_HOST}, Storage=${STORAGE_EMULATOR_HOST}"

# --- Type-specific setup ---
case "$APP_TYPE" in
  firebase)
    # Static Firebase app with Firebase emulators
    echo "Starting Firebase emulators..."
    source "${ROOT_DIR}/infrastructure/scripts/start-emulators.sh"

    # Export emulator env vars
    export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-localhost:8081}"
    export STORAGE_EMULATOR_HOST="${STORAGE_EMULATOR_HOST:-localhost:9199}"
    export FIREBASE_AUTH_EMULATOR_HOST="${FIREBASE_AUTH_EMULATOR_HOST:-localhost:9099}"
    export GCP_PROJECT_ID="${GCP_PROJECT_ID:-demo-test}"

    # Set up cleanup trap
    cleanup() {
      echo "Stopping emulators..."
      "${ROOT_DIR}/infrastructure/scripts/stop-emulators.sh" || true
    }
    trap cleanup EXIT

    echo "Building..."
    pnpm --dir "${APP_PATH_ABS}/site" build
    ;;

  go-fullstack)
    # Go app with Firebase emulators
    echo "Starting Firebase emulators..."
    source "${ROOT_DIR}/infrastructure/scripts/start-emulators.sh"

    # Export emulator env vars
    export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-localhost:8081}"
    export STORAGE_EMULATOR_HOST="${STORAGE_EMULATOR_HOST:-localhost:9199}"
    export FIREBASE_AUTH_EMULATOR_HOST="${FIREBASE_AUTH_EMULATOR_HOST:-localhost:9099}"
    export GCP_PROJECT_ID="${GCP_PROJECT_ID:-demo-test}"

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
  npx playwright test

elif [ "$APP_TYPE" = "go-tui" ] || [ "$APP_TYPE" = "go-fullstack" ]; then
  # Go apps use make test-e2e
  echo "Running Go E2E tests..."
  make test-e2e
fi

echo "Tests passed: $APP_NAME"
