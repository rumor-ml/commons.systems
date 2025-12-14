#!/usr/bin/env bash
set -euo pipefail

# Start development server for a module
# Each worktree runs ISOLATED dev servers with unique ports for concurrent development
#
# Usage:
#   ./start-dev-server.sh <module-name> [--with-emulators]
#
# Examples:
#   ./start-dev-server.sh printsync
#   ./start-dev-server.sh printsync --with-emulators
#   ./start-dev-server.sh fellspiral

# Parse arguments
if [ $# -lt 1 ]; then
  echo "Usage: $0 <module-name> [--with-emulators]"
  echo ""
  echo "Available modules: printsync, fellspiral, etc."
  echo ""
  echo "Options:"
  echo "  --with-emulators    Start Firebase emulators before starting dev server"
  exit 1
fi

MODULE_NAME="$1"
WITH_EMULATORS=false

if [ $# -gt 1 ] && [ "$2" = "--with-emulators" ]; then
  WITH_EMULATORS=true
fi

# Source port allocation script to get shared ports
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Get repository root
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Worktree-specific PID and log files (use WORKTREE_TMP_DIR from allocate-test-ports.sh)
PID_FILE="${WORKTREE_TMP_DIR}/dev-server.pid"
LOG_FILE="${WORKTREE_TMP_DIR}/dev-server.log"
MODULE_FILE="${WORKTREE_TMP_DIR}/dev-server.module"

# Check if dev server is already running
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    RUNNING_MODULE=$(cat "$MODULE_FILE" 2>/dev/null || echo "unknown")
    echo "Dev server already running for this worktree!"
    echo "  Module: $RUNNING_MODULE"
    echo "  PID: $PID"
    echo "  URL: http://localhost:${PORT}"
    echo ""
    echo "Stop it first with: ./infrastructure/scripts/stop-dev-server.sh"
    exit 1
  else
    # Stale PID file, clean it up
    rm -f "$PID_FILE" "$MODULE_FILE"
  fi
fi

# Start emulators if requested
if [ "$WITH_EMULATORS" = true ]; then
  echo "Starting Firebase emulators first..."
  "${SCRIPT_DIR}/start-emulators.sh"
  echo ""
fi

# Determine module path and type
MODULE_PATH="${REPO_ROOT}/${MODULE_NAME}"

if [ ! -d "$MODULE_PATH" ]; then
  echo "ERROR: Module directory not found: $MODULE_PATH"
  exit 1
fi

# Detect module type and start appropriate server
echo "Starting dev server for module: ${MODULE_NAME}"
echo "  Port: ${PORT}"
echo "  Log file: ${LOG_FILE}"
echo ""

# Function to detect module type
detect_module_type() {
  # Check for Go fullstack (has site/ with Makefile that includes air/dev)
  if [ -f "${MODULE_PATH}/site/Makefile" ] && grep -q "air\|dev/server" "${MODULE_PATH}/site/Makefile" 2>/dev/null; then
    echo "go-fullstack"
    return
  fi

  # Check for Vite-based site (has site/vite.config.js)
  if [ -f "${MODULE_PATH}/site/vite.config.js" ]; then
    echo "vite"
    return
  fi

  # Check for Firebase-only (has site/ with package.json but no Go)
  if [ -f "${MODULE_PATH}/site/package.json" ] && [ ! -f "${MODULE_PATH}/site/Makefile" ]; then
    echo "firebase"
    return
  fi

  echo "unknown"
}

MODULE_TYPE=$(detect_module_type)

echo "Detected module type: ${MODULE_TYPE}"

# Start the appropriate server
case "$MODULE_TYPE" in
  go-fullstack)
    echo "Starting Go fullstack dev server (air + templ + tailwind)..."
    cd "${MODULE_PATH}/site"

    # Export environment variables for the dev server
    export GO_ENV=development
    export GCP_PROJECT_ID=demo-test
    export PORT="${PORT}"

    # Export emulator connection strings if WITH_EMULATORS is true
    if [ "$WITH_EMULATORS" = true ]; then
      export FIREBASE_AUTH_EMULATOR_HOST="localhost:${FIREBASE_AUTH_PORT}"
      export FIRESTORE_EMULATOR_HOST="localhost:${FIREBASE_FIRESTORE_PORT}"
      export STORAGE_EMULATOR_HOST="localhost:${FIREBASE_STORAGE_PORT}"
    fi

    # Start dev server using make (runs air + templ + tailwind in parallel)
    make dev > "$LOG_FILE" 2>&1 &
    DEV_SERVER_PID=$!
    ;;

  vite)
    echo "Starting Vite dev server..."
    cd "${MODULE_PATH}/site"

    # Set port for Vite
    export PORT="${PORT}"

    # Export emulator connection strings if WITH_EMULATORS is true
    if [ "$WITH_EMULATORS" = true ]; then
      export VITE_FIREBASE_AUTH_EMULATOR_HOST="localhost:${FIREBASE_AUTH_PORT}"
      export VITE_FIRESTORE_EMULATOR_HOST="localhost:${FIREBASE_FIRESTORE_PORT}"
      export VITE_STORAGE_EMULATOR_HOST="localhost:${FIREBASE_STORAGE_PORT}"
    fi

    # Start Vite with custom port
    pnpm dev --port "${PORT}" > "$LOG_FILE" 2>&1 &
    DEV_SERVER_PID=$!
    ;;

  firebase)
    echo "Starting Firebase dev server..."
    cd "${MODULE_PATH}/site"

    # Export emulator connection strings if WITH_EMULATORS is true
    if [ "$WITH_EMULATORS" = true ]; then
      export VITE_FIREBASE_AUTH_EMULATOR_HOST="localhost:${FIREBASE_AUTH_PORT}"
      export VITE_FIRESTORE_EMULATOR_HOST="localhost:${FIREBASE_FIRESTORE_PORT}"
      export VITE_STORAGE_EMULATOR_HOST="localhost:${FIREBASE_STORAGE_PORT}"
    fi

    # Start npm dev script
    npm run dev -- --port "${PORT}" > "$LOG_FILE" 2>&1 &
    DEV_SERVER_PID=$!
    ;;

  *)
    echo "ERROR: Unknown module type for ${MODULE_NAME}"
    echo "Cannot determine how to start dev server"
    exit 1
    ;;
esac

# Save PID and module name
echo "$DEV_SERVER_PID" > "$PID_FILE"
echo "$MODULE_NAME" > "$MODULE_FILE"

echo "Dev server started with PID: ${DEV_SERVER_PID}"
echo ""

# Wait for server to be ready (health check)
echo "Waiting for dev server to be ready on port ${PORT}..."
MAX_RETRIES=60
RETRY_INTERVAL=1
RETRY_COUNT=0

while ! nc -z localhost ${PORT} 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "ERROR: Dev server failed to start after ${MAX_RETRIES} seconds"
    echo "Last 20 lines of dev server log:"
    tail -n 20 "$LOG_FILE"
    kill $DEV_SERVER_PID 2>/dev/null || true
    rm -f "$PID_FILE" "$MODULE_FILE"
    exit 1
  fi
  sleep $RETRY_INTERVAL
done

echo ""
echo "Dev server is ready!"
echo ""
echo "Module: ${MODULE_NAME}"
echo "URL: http://localhost:${PORT}"
echo "PID: ${DEV_SERVER_PID}"
echo "Log: ${LOG_FILE}"

if [ "$WITH_EMULATORS" = true ]; then
  echo ""
  echo "Firebase Emulators:"
  echo "  Auth: localhost:${FIREBASE_AUTH_PORT}"
  echo "  Firestore: localhost:${FIREBASE_FIRESTORE_PORT}"
  echo "  Storage: localhost:${FIREBASE_STORAGE_PORT}"
  echo "  UI: http://localhost:${FIREBASE_UI_PORT}"
fi

echo ""
echo "To stop: ./infrastructure/scripts/stop-dev-server.sh"
