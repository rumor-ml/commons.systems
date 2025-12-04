#!/usr/bin/env bash
set -euo pipefail

# Get worktree root directory name
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Hash the worktree name and calculate offset (for app port only)
# Use cksum for cross-platform compatibility
HASH=$(echo -n "$WORKTREE_NAME" | cksum | awk '{print $1}')
OFFSET=$((($HASH % 100) * 10))

# Calculate unique app port per worktree
APP_PORT=$((8080 + $OFFSET))

# Emulators are shared - use default ports
# These can still be overridden by environment if needed
AUTH_PORT=${FIREBASE_AUTH_PORT:-9099}
FIRESTORE_PORT=${FIREBASE_FIRESTORE_PORT:-8081}
STORAGE_PORT=${FIREBASE_STORAGE_PORT:-9199}

# Export all port variables
export TEST_PORT="$APP_PORT"
export PORT="$APP_PORT"  # For Go app

# Export emulator connections (shared ports)
export FIREBASE_AUTH_EMULATOR_HOST="localhost:${AUTH_PORT}"
export FIRESTORE_EMULATOR_HOST="localhost:${FIRESTORE_PORT}"
export STORAGE_EMULATOR_HOST="localhost:${STORAGE_PORT}"

# Print allocated ports for debugging
echo "Allocated ports for worktree '${WORKTREE_NAME}':"
echo "  App server: $APP_PORT (unique per worktree)"
echo "  Firebase Auth: $AUTH_PORT (shared)"
echo "  Firestore: $FIRESTORE_PORT (shared)"
echo "  Storage: $STORAGE_PORT (shared)"
