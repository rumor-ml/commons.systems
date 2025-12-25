#!/usr/bin/env bash
set -eu

# Get worktree root directory path
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Hash the current worktree root directory path (from git rev-parse --show-toplevel) for deterministic port allocation.
# This ensures:
# 1. The same worktree path always gets the same ports (path-based hash)
# 2. Moving a worktree to a different location will get different ports (path changes)
# 3. Different worktree paths get different ports (even with same branch name)
# 4. Ports remain stable across emulator restarts within same worktree path
# 5. Hash is computed from the absolute worktree path, not an external identifier
# Use cksum for cross-platform compatibility (macOS and Linux)
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

# Export port variables for emulators (unique per worktree)
export FIREBASE_AUTH_PORT="$AUTH_PORT"
export FIREBASE_FIRESTORE_PORT="$FIRESTORE_PORT"
export FIREBASE_STORAGE_PORT="$STORAGE_PORT"
export FIREBASE_UI_PORT="$UI_PORT"

# Export app port variables (unique per worktree)
export TEST_PORT="$APP_PORT"
export PORT="$APP_PORT"  # For Go app

# Export emulator connection strings
# Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues
# (emulator binds to IPv4 only, but localhost may resolve to IPv6 ::1)
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:${AUTH_PORT}"
export FIRESTORE_EMULATOR_HOST="127.0.0.1:${FIRESTORE_PORT}"
export STORAGE_EMULATOR_HOST="127.0.0.1:${STORAGE_PORT}"

# Port availability check function
# Returns 0 if port is available, 1 if in use
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
