#!/usr/bin/env bash
set -eu

# Get script directory and source port utilities
# When sourced by start-emulators.sh, SCRIPT_DIR is already set
if [ -z "${SCRIPT_DIR:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
source "${SCRIPT_DIR}/port-utils.sh"

# Get worktree root directory path
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Hash the worktree path (not just name) for deterministic port allocation
# Use cksum for cross-platform compatibility
HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
PORT_OFFSET=$(($HASH % 100))

# SHARED EMULATOR PORTS - Same across all worktrees (from firebase.json)
# Multiple worktrees connect to the same emulator instance
AUTH_PORT=9099
FIRESTORE_PORT=8081
STORAGE_PORT=9199
UI_PORT=4000

# UNIQUE APP SERVER PORT - Different per worktree
# Prevents conflicts when running multiple app servers concurrently
APP_PORT=$((8080 + ($PORT_OFFSET * 10)))

# PER-WORKTREE HOSTING EMULATOR PORT - Different per worktree
# Hosting emulator serves from relative path → must be per-worktree
# Use automatic port fallback to avoid system-reserved ports (5000, 5001, etc.)
BASE_HOSTING_PORT=$((5000 + ($PORT_OFFSET * 10)))
HOSTING_PORT=$(find_available_port $BASE_HOSTING_PORT 10 10)

# Check if fallback was used
if [ $? -ne 0 ]; then
  echo "FATAL: Could not allocate hosting port in range ${BASE_HOSTING_PORT}-$((BASE_HOSTING_PORT + 100))" >&2
  exit 1
fi

if [ "$HOSTING_PORT" != "$BASE_HOSTING_PORT" ]; then
  echo "⚠️  Using fallback port $HOSTING_PORT (base $BASE_HOSTING_PORT was unavailable)"
  echo ""
fi

# PER-WORKTREE PROJECT ID - For Firestore data isolation
# Allows multiple worktrees to share emulator process but isolate data
PROJECT_ID="demo-test-${HASH}"

# Export port variables for emulators (shared)
export FIREBASE_AUTH_PORT="$AUTH_PORT"
export FIREBASE_FIRESTORE_PORT="$FIRESTORE_PORT"
export FIREBASE_STORAGE_PORT="$STORAGE_PORT"
export FIREBASE_UI_PORT="$UI_PORT"

# Export per-worktree variables
export HOSTING_PORT  # For per-worktree hosting emulator
export PROJECT_ID    # For Firestore data isolation
export GCP_PROJECT_ID="${PROJECT_ID}"  # Firebase SDK uses this
export TEST_PORT="$APP_PORT"  # For legacy app servers
export PORT="$APP_PORT"  # For Go app

# Export emulator connection strings
export FIREBASE_AUTH_EMULATOR_HOST="localhost:${AUTH_PORT}"
export FIRESTORE_EMULATOR_HOST="localhost:${FIRESTORE_PORT}"
export STORAGE_EMULATOR_HOST="localhost:${STORAGE_PORT}"

# Print allocated ports for debugging
echo "Port allocation for worktree '${WORKTREE_NAME}':"
echo "  App server: $APP_PORT (unique per worktree)"
echo "  Hosting emulator: $HOSTING_PORT (unique per worktree)"
echo "  Project ID: $PROJECT_ID (unique per worktree)"
echo ""
echo "Shared backend emulators (all worktrees):"
echo "  Firebase Auth: $AUTH_PORT"
echo "  Firestore: $FIRESTORE_PORT"
echo "  Storage: $STORAGE_PORT"
echo "  UI: $UI_PORT"
echo ""
echo "Emulator architecture:"
echo "  - Backend services (Firestore/Auth/Storage) are shared for efficiency"
echo "  - Hosting emulator is per-worktree (serves worktree-specific build)"
echo "  - Project IDs isolate Firestore data per worktree"
