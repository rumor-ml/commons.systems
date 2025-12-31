#!/usr/bin/env bash
set -eu

# Get script directory and source port utilities
# When sourced by start-emulators.sh, SCRIPT_DIR is already set
if [ -z "${SCRIPT_DIR:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
source "${SCRIPT_DIR}/port-utils.sh"

# Validate port is in valid range
validate_port() {
  local port=$1
  local name=$2

  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "FATAL: Invalid $name port: $port (must be 1-65535)" >&2
    exit 1
  fi
}

# Get worktree root directory path
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Hash the worktree path (not just name) for deterministic port allocation
# Use cksum for cross-platform compatibility
HASH_OUTPUT=$(echo -n "$WORKTREE_ROOT" | cksum 2>&1)
if [ $? -ne 0 ]; then
  echo "FATAL: cksum command failed" >&2
  echo "Output: $HASH_OUTPUT" >&2
  exit 1
fi

HASH=$(echo "$HASH_OUTPUT" | awk '{print $1}')

# Validate HASH is numeric
if ! [[ "$HASH" =~ ^[0-9]+$ ]]; then
  echo "FATAL: cksum produced non-numeric output" >&2
  echo "Expected: number, got: $HASH" >&2
  echo "Full cksum output: $HASH_OUTPUT" >&2
  exit 1
fi

# Calculate offset
PORT_OFFSET=$(($HASH % 100))

# Validate offset is in expected range (defensive programming - mathematically should always pass)
if [ "$PORT_OFFSET" -lt 0 ] || [ "$PORT_OFFSET" -gt 99 ]; then
  echo "FATAL: PORT_OFFSET out of range: $PORT_OFFSET (expected 0-99)" >&2
  echo "This should be impossible - please report this bug" >&2
  echo "HASH=$HASH, WORKTREE_ROOT=$WORKTREE_ROOT" >&2
  exit 1
fi

# SHARED EMULATOR PORTS - Standard Firebase emulator ports (match firebase.json)
# Multiple worktrees connect to the same emulator instance
AUTH_PORT=9099
FIRESTORE_PORT=8081
STORAGE_PORT=9199
UI_PORT=4000

# UNIQUE APP SERVER PORT - Different per worktree
# Prevents conflicts when running multiple app servers concurrently
# Port range: [8080, 9070] (8080 + 0*10 to 8080 + 99*10)
APP_PORT=$((8080 + ($PORT_OFFSET * 10)))
validate_port "$APP_PORT" "APP"

# PER-WORKTREE HOSTING EMULATOR PORT - Different per worktree
# Hosting emulator serves from relative path → must be per-worktree
# Use automatic port fallback to avoid system-reserved ports (5000, 5001, etc.)
# Base port range: [5000, 5990] (5000 + 0*10 to 5000 + 99*10)
BASE_HOSTING_PORT=$((5000 + ($PORT_OFFSET * 10)))
validate_port "$BASE_HOSTING_PORT" "BASE_HOSTING"

# Allocate hosting port with automatic fallback
# Note: find_available_port outputs diagnostic messages to stderr and port number to stdout
HOSTING_PORT=$(find_available_port $BASE_HOSTING_PORT 10 10)
PORT_ALLOC_STATUS=$?

# Check if allocation succeeded
if [ $PORT_ALLOC_STATUS -ne 0 ]; then
  echo "FATAL: Could not allocate hosting port in range ${BASE_HOSTING_PORT}-$((BASE_HOSTING_PORT + 100))" >&2
  echo "All candidate ports are in use or blacklisted" >&2
  echo "Check stderr output above from find_available_port for details" >&2
  exit 1
fi

# Validate port is a valid number
if ! [[ "$HOSTING_PORT" =~ ^[0-9]+$ ]]; then
  echo "FATAL: Port allocation returned invalid value: ${HOSTING_PORT}" >&2
  echo "Expected a numeric port, check find_available_port implementation" >&2
  exit 1
fi

# Check if fallback was used (only show when run directly, not when sourced)
if [ "$HOSTING_PORT" != "$BASE_HOSTING_PORT" ] && [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
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

# Print allocated ports for debugging (only when run directly, not when sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
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
fi
