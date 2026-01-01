#!/usr/bin/env bash
set -euo pipefail

# Stop Firebase emulators (backend and hosting)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source port utilities for process management
source "${SCRIPT_DIR}/port-utils.sh"

# Source allocate-test-ports.sh to get PROJECT_ID
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# PID files for backend and hosting emulators
BACKEND_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-backend-emulators.pid"
HOSTING_PID_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid"

# Log files
BACKEND_LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-backend-emulators.log"
HOSTING_LOG_FILE="${PROJECT_ROOT}/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.log"

# Temp config file
TEMP_CONFIG="${PROJECT_ROOT}/.firebase-${PROJECT_ID}.json"

echo "Stopping Firebase emulators..."
echo ""

# Stop hosting emulator (per-worktree)
if [ -f "$HOSTING_PID_FILE" ]; then
  echo "Stopping hosting emulator..."

  # Use port-utils.sh functions for PID file parsing and process killing
  if parse_pid_file "$HOSTING_PID_FILE"; then
    kill_process_group "$PARSED_PID" "$PARSED_PGID"
    echo "✓ Successfully stopped hosting emulator"
  else
    echo "WARNING: PID file exists but could not be parsed" >&2
    echo "Skipping PID-based cleanup - will attempt port-based cleanup" >&2
  fi

  # Clean up hosting PID file
  rm -f "$HOSTING_PID_FILE"
  echo "✓ Cleaned up hosting PID file"

  # Clean up hosting log file
  if [ -f "$HOSTING_LOG_FILE" ]; then
    rm -f "$HOSTING_LOG_FILE"
    echo "✓ Cleaned up hosting log file"
  fi

  # Clean up temp config
  if [ -f "$TEMP_CONFIG" ]; then
    rm -f "$TEMP_CONFIG"
    echo "✓ Cleaned up temp config"
  fi
  echo ""
else
  echo "No hosting emulator PID file found (may not be running)"
  echo ""
fi

# Stop backend emulators (shared - only stop if requested)
if [ -f "$BACKEND_PID_FILE" ]; then
  echo "Backend emulators are shared across worktrees."
  echo "PID file: ${BACKEND_PID_FILE}"
  echo ""
  echo "To stop backend emulators (will affect all worktrees):"
  echo "  kill \$(cat ${BACKEND_PID_FILE})"
  echo "  rm -f ${BACKEND_PID_FILE}"
  echo ""
else
  echo "No backend emulator PID file found (may not be running)"
  echo ""
fi

echo "✓ Hosting emulator stopped successfully"
