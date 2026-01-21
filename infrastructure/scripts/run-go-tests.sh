#!/usr/bin/env bash
# Run Go integration tests with Firestore emulator
# This script starts the Firestore emulator, runs the tests, and cleans up
set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Navigate to the project root to ensure firebase.json is found
cd "$PROJECT_ROOT"

# Setup cleanup trap
cleanup() {
  echo "Cleaning up Firestore emulator..."
  if [ ! -z "$EMULATOR_PID" ]; then
    kill $EMULATOR_PID 2>/dev/null || true
    wait $EMULATOR_PID 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== Starting Firestore Emulator ==="
# TODO(#327): Add emulator startup verification before health check
# Start emulator in background with explicit project ID
npx firebase-tools emulators:start --only firestore --project=demo-test > /tmp/emulator.log 2>&1 &
EMULATOR_PID=$!

echo "Waiting for Firestore emulator to be ready..."
# Wait for emulator to be ready (check health endpoint)
MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s http://localhost:8081 > /dev/null 2>&1; then
    echo "Firestore emulator is ready!"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "Error: Firestore emulator failed to start"
    cat /tmp/emulator.log
    exit 1
  fi
  sleep 1
done

echo "=== Running Go Integration Tests ==="
# Set environment variable to point to emulator
export FIRESTORE_EMULATOR_HOST=localhost:8081

# Navigate to the filesync directory and run tests
cd "$PROJECT_ROOT/pkg/filesync"
go test -v -json ./...

echo "=== Tests completed successfully ==="
