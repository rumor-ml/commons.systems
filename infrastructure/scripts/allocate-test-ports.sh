#!/usr/bin/env bash
set -eu

# Get worktree root directory path
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Hash the worktree path (not just name) for deterministic port allocation
# Use cksum for cross-platform compatibility
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PORT_OFFSET=$(($HASH % 100))

# Export hash and worktree-specific temp directory
export WORKTREE_HASH="$HASH"
export WORKTREE_TMP_DIR="/tmp/claude/${WORKTREE_HASH}"

# Create worktree-specific temp directory
mkdir -p "$WORKTREE_TMP_DIR"

# UNIQUE EMULATOR PORTS - Different per worktree
# Each worktree runs isolated emulators for concurrent testing
AUTH_PORT=$((10000 + ($PORT_OFFSET * 10)))
FIRESTORE_PORT=$((11000 + ($PORT_OFFSET * 10)))
STORAGE_PORT=$((12000 + ($PORT_OFFSET * 10)))
UI_PORT=$((13000 + ($PORT_OFFSET * 10)))

# UNIQUE APP SERVER PORT - Different per worktree
# Prevents conflicts when running multiple app servers concurrently
APP_PORT=$((8080 + ($PORT_OFFSET * 10)))

# Export port variables for emulators (shared)
export FIREBASE_AUTH_PORT="$AUTH_PORT"
export FIREBASE_FIRESTORE_PORT="$FIRESTORE_PORT"
export FIREBASE_STORAGE_PORT="$STORAGE_PORT"
export FIREBASE_UI_PORT="$UI_PORT"

# Export app port variables (unique per worktree)
export TEST_PORT="$APP_PORT"
export PORT="$APP_PORT"  # For Go app

# Export emulator connection strings
export FIREBASE_AUTH_EMULATOR_HOST="localhost:${AUTH_PORT}"
export FIRESTORE_EMULATOR_HOST="localhost:${FIRESTORE_PORT}"
export STORAGE_EMULATOR_HOST="localhost:${STORAGE_PORT}"

# Port availability check function
# Tries BASE_OFFSET first, then probes for available ports if needed
check_port_available() {
  local port=$1
  if lsof -ti :${port} >/dev/null 2>&1; then
    return 1  # Port in use
  else
    return 0  # Port available
  fi
}

# Find next available port starting from base
find_available_port() {
  local base_port=$1
  local port=$base_port
  while ! check_port_available $port; do
    port=$((port + 1))
    if [ $port -gt $((base_port + 1000)) ]; then
      echo "ERROR: Could not find available port near $base_port" >&2
      exit 1
    fi
  done
  echo $port
}

# Print allocated ports for debugging
echo "Port allocation for worktree '${WORKTREE_NAME}' (offset: ${PORT_OFFSET}):"
echo "  Temp directory: $WORKTREE_TMP_DIR"
echo "  App server: $APP_PORT (unique)"
echo "  Firebase Auth: $AUTH_PORT (unique)"
echo "  Firestore: $FIRESTORE_PORT (unique)"
echo "  Storage: $STORAGE_PORT (unique)"
echo "  UI: $UI_PORT (unique)"
echo ""
echo "Each worktree runs isolated emulators for concurrent testing!"
