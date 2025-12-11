#!/usr/bin/env bash
set -eu

# Get worktree root directory path
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Hash the worktree path (not just name) for deterministic port allocation
# Use cksum for cross-platform compatibility
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PORT_OFFSET=$(($HASH % 100))

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

# Print allocated ports for debugging
echo "Port allocation for worktree '${WORKTREE_NAME}' (offset: ${PORT_OFFSET}):"
echo "  App server: $APP_PORT (unique)"
echo "  Firebase Auth: $AUTH_PORT (unique)"
echo "  Firestore: $FIRESTORE_PORT (unique)"
echo "  Storage: $STORAGE_PORT (unique)"
echo "  UI: $UI_PORT (unique)"
echo ""
echo "Each worktree runs isolated emulators for concurrent testing!"
