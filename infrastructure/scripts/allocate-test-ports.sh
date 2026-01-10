#!/usr/bin/env bash
set -eu

# Helper function to exit/return appropriately based on how script is invoked
# When sourced: use return to allow parent script to handle error
# When executed: use exit to terminate with error code
exit_or_return() {
  local code=$1
  if [[ "${BASH_SOURCE[1]}" != "${0}" ]]; then
    # Script is being sourced - use return
    return "$code"
  else
    # Script is being executed directly - use exit
    exit "$code"
  fi
}

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
    exit_or_return 1
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
  exit_or_return 1
fi

HASH=$(echo "$HASH_OUTPUT" | awk '{print $1}')

# Validate HASH is numeric
if ! [[ "$HASH" =~ ^[0-9]+$ ]]; then
  echo "FATAL: cksum produced non-numeric output" >&2
  echo "Expected: number, got: $HASH" >&2
  echo "Full cksum output: $HASH_OUTPUT" >&2
  exit_or_return 1
fi

# Calculate offset
PORT_OFFSET=$(($HASH % 100))

# TODO(#1224): Simplify verbose comment - remove redundant defensive programming note
# Validate offset is in expected range (defensive programming - mathematically should always pass)
if [ "$PORT_OFFSET" -lt 0 ] || [ "$PORT_OFFSET" -gt 99 ]; then
  echo "FATAL: PORT_OFFSET out of range: $PORT_OFFSET (expected 0-99)" >&2
  echo "This should be impossible - please report this bug" >&2
  echo "HASH=$HASH, WORKTREE_ROOT=$WORKTREE_ROOT" >&2
  exit_or_return 1
fi

# SHARED EMULATOR PORTS - Sourced from generate-firebase-ports.sh
# Multiple worktrees connect to the same emulator instance
# The generator script extracts ports from firebase.json (single source of truth)

# Capture generate-firebase-ports.sh output and errors to temporary files
# This allows us to show actual jq/firebase.json errors instead of generic failure messages
GEN_STDERR=$(mktemp) || {
  echo "FATAL: Failed to create temporary file for stderr capture" >&2
  echo "This indicates a filesystem problem:" >&2
  echo "- Disk space: df -h /tmp" >&2
  echo "- Permissions: ls -ld /tmp" >&2
  echo "- Mount options: mount | grep /tmp" >&2
  exit_or_return 1
}

GEN_OUTPUT=$(mktemp) || {
  echo "FATAL: Failed to create temporary file for output capture" >&2
  rm -f "$GEN_STDERR"  # Clean up first temp file
  exit_or_return 1
}

trap "rm -f '$GEN_STDERR' '$GEN_OUTPUT' 2>/dev/null || true" RETURN

if ! "${SCRIPT_DIR}/generate-firebase-ports.sh" > "$GEN_OUTPUT" 2> "$GEN_STDERR"; then
  echo "FATAL: generate-firebase-ports.sh failed" >&2
  echo "" >&2
  if [ -s "$GEN_STDERR" ]; then
    echo "Error details:" >&2
    cat "$GEN_STDERR" >&2
    echo "" >&2
  fi
  echo "This script extracts Firebase emulator ports from firebase.json" >&2
  echo "Check that:" >&2
  echo "1. jq is installed: command -v jq" >&2
  echo "2. firebase.json exists at: ${WORKTREE_ROOT}/firebase.json" >&2
  echo "3. firebase.json is valid JSON" >&2
  echo "4. firebase.json contains .emulators.{auth,firestore,storage,ui}.port" >&2
  echo "5. generate-firebase-ports.sh is executable: ${SCRIPT_DIR}/generate-firebase-ports.sh" >&2
  exit_or_return 1
fi

# Source the validated output
source "$GEN_OUTPUT"

# Validate ports were loaded successfully - report which specific ports failed
missing_ports=""
[ -z "${AUTH_PORT:-}" ] && missing_ports="${missing_ports}AUTH_PORT "
[ -z "${FIRESTORE_PORT:-}" ] && missing_ports="${missing_ports}FIRESTORE_PORT "
[ -z "${STORAGE_PORT:-}" ] && missing_ports="${missing_ports}STORAGE_PORT "
[ -z "${UI_PORT:-}" ] && missing_ports="${missing_ports}UI_PORT "

if [ -n "$missing_ports" ]; then
  echo "FATAL: Failed to load Firebase emulator ports from firebase.json" >&2
  echo "Missing port variables: $missing_ports" >&2
  echo "" >&2
  echo "Troubleshooting steps:" >&2
  echo "1. Verify firebase.json exists at: ${WORKTREE_ROOT}/firebase.json" >&2
  echo "2. Check that firebase.json contains .emulators.{auth,firestore,storage,ui}.port" >&2
  echo "3. Verify generate-firebase-ports.sh is executable: ${SCRIPT_DIR}/generate-firebase-ports.sh" >&2
  echo "4. Ensure jq is installed: command -v jq" >&2
  exit_or_return 1
fi

# Validate loaded ports are numeric and in valid range
validate_port "$AUTH_PORT" "AUTH" || exit_or_return 1
validate_port "$FIRESTORE_PORT" "FIRESTORE" || exit_or_return 1
validate_port "$STORAGE_PORT" "STORAGE" || exit_or_return 1
validate_port "$UI_PORT" "UI" || exit_or_return 1

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
  exit_or_return 1
fi

# Validate port is a valid number
if ! [[ "$HOSTING_PORT" =~ ^[0-9]+$ ]]; then
  echo "FATAL: Port allocation returned invalid value: ${HOSTING_PORT}" >&2
  echo "Expected a numeric port, check find_available_port implementation" >&2
  exit_or_return 1
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
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:${AUTH_PORT}"
export FIRESTORE_EMULATOR_HOST="127.0.0.1:${FIRESTORE_PORT}"
export STORAGE_EMULATOR_HOST="127.0.0.1:${STORAGE_PORT}"

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
