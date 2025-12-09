#!/bin/sh
# POSIX-compatible script - must work when sourced by /bin/sh
# Do not use bash-specific features like 'pipefail'
set -eu

# Get worktree root directory path
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Hash the worktree path (not just name) for deterministic port allocation
# Use cksum for cross-platform compatibility
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PORT_OFFSET=$(($HASH % 100))

# SHARED EMULATOR PORTS - Same across all worktrees
# Multiple worktrees connect to the same emulator instance
AUTH_PORT=9099
FIRESTORE_PORT=8081
STORAGE_PORT=9199
UI_PORT=4000

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
echo "Port allocation for worktree '${WORKTREE_NAME}':"
echo "  App server: $APP_PORT (unique per worktree)"
echo "  Firebase Auth: $AUTH_PORT (shared)"
echo "  Firestore: $FIRESTORE_PORT (shared)"
echo "  Storage: $STORAGE_PORT (shared)"
echo "  UI: $UI_PORT (shared)"
echo ""
echo "Emulators are shared across worktrees - efficient resource usage!"
