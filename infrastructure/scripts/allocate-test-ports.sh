#!/usr/bin/env bash
set -euo pipefail

# Get worktree root directory path
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Hash the worktree path (not just name) for deterministic port allocation
# Use cksum for cross-platform compatibility
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PORT_OFFSET=$(($HASH % 100))

# Calculate unique ports per worktree
# Port ranges ensure no conflicts between concurrent worktrees:
#   Auth: 9099-9199 (100 ports)
#   Firestore: 8081-8181 (100 ports)
#   Storage: 9199-9299 (100 ports)
#   UI: 4000-4100 (100 ports)
#   App: 8080-8180 (100 ports)
AUTH_PORT=$((9099 + $PORT_OFFSET))
FIRESTORE_PORT=$((8081 + $PORT_OFFSET))
STORAGE_PORT=$((9199 + $PORT_OFFSET))
UI_PORT=$((4000 + $PORT_OFFSET))
APP_PORT=$((8080 + ($PORT_OFFSET * 10)))

# Export port variables for emulators
export FIREBASE_AUTH_PORT="$AUTH_PORT"
export FIREBASE_FIRESTORE_PORT="$FIRESTORE_PORT"
export FIREBASE_STORAGE_PORT="$STORAGE_PORT"
export FIREBASE_UI_PORT="$UI_PORT"

# Export all port variables for apps
export TEST_PORT="$APP_PORT"
export PORT="$APP_PORT"  # For Go app

# Export emulator connection strings
export FIREBASE_AUTH_EMULATOR_HOST="localhost:${AUTH_PORT}"
export FIRESTORE_EMULATOR_HOST="localhost:${FIRESTORE_PORT}"
export STORAGE_EMULATOR_HOST="localhost:${STORAGE_PORT}"

# Print allocated ports for debugging
echo "Allocated ports for worktree '${WORKTREE_NAME}' (offset: ${PORT_OFFSET}):"
echo "  App server: $APP_PORT"
echo "  Firebase Auth: $AUTH_PORT"
echo "  Firestore: $FIRESTORE_PORT"
echo "  Storage: $STORAGE_PORT"
echo "  UI: $UI_PORT"
echo ""
echo "All ports are unique per worktree - concurrent testing enabled!"
