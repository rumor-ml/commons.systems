#!/bin/bash
# Test a Go fullstack app (build + E2E)
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <app-path>"
  exit 1
fi

if [ ! -d "$1" ]; then
  echo "Error: Directory '$1' does not exist"
  exit 1
fi

APP_PATH="$1"
APP_NAME=$(basename "$APP_PATH")

# Get the root directory (2 levels up from infrastructure/scripts)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Set up trap to stop emulators on exit
cleanup() {
  echo ""
  echo "--- Stopping Emulators ---"
  "${ROOT_DIR}/infrastructure/scripts/stop-emulators.sh"
}
trap cleanup EXIT

echo "--- Starting Emulators ---"
# Source the start script to get environment variables
source "${ROOT_DIR}/infrastructure/scripts/start-emulators.sh"

# Export emulator environment variables for the tests
export FIRESTORE_EMULATOR_HOST="localhost:8081"
export STORAGE_EMULATOR_HOST="localhost:9199"

cd "${APP_PATH}/site"

echo ""
echo "--- Building ---"
make build

echo ""
echo "--- E2E Tests ---"
cd "../tests"
CI=true npx playwright test --project chromium

echo "Tests passed for $APP_NAME"
