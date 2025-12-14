#!/usr/bin/env bash
set -euo pipefail

# Show status of development server for THIS worktree
# Each worktree has isolated dev servers
#
# Usage:
#   ./dev-server-status.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/allocate-test-ports.sh"

# Use WORKTREE_TMP_DIR from allocate-test-ports.sh
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
PID_FILE="${WORKTREE_TMP_DIR}/dev-server.pid"
MODULE_FILE="${WORKTREE_TMP_DIR}/dev-server.module"

# Check for emulator status
EMULATOR_PID_FILE="${WORKTREE_TMP_DIR}/firebase-emulators.pid"

echo "Dev Server Status for Worktree: $(basename "$WORKTREE_ROOT")"
echo "================================================"
echo ""

# Check dev server status
if [ ! -f "$PID_FILE" ]; then
  echo "Dev Server: NOT RUNNING"
  echo "  (no PID file found at $PID_FILE)"
else
  PID=$(cat "$PID_FILE")
  MODULE_NAME=$(cat "$MODULE_FILE" 2>/dev/null || echo "unknown")

  if kill -0 "$PID" 2>/dev/null; then
    echo "Dev Server: RUNNING"
    echo "  Module: ${MODULE_NAME}"
    echo "  PID: ${PID}"
    echo "  Port: ${PORT}"
    echo "  URL: http://localhost:${PORT}"

    # Check if port is actually listening
    if nc -z localhost ${PORT} 2>/dev/null; then
      echo "  Status: ✓ Listening on port ${PORT}"
    else
      echo "  Status: ⚠️  Process running but port ${PORT} not accessible"
    fi
  else
    echo "Dev Server: STOPPED"
    echo "  (stale PID file found: ${PID})"
    echo "  Clean up with: ./infrastructure/scripts/stop-dev-server.sh"
  fi
fi

echo ""
echo "Firebase Emulators"
echo "------------------------------------------------"

# Check emulator status
if [ ! -f "$EMULATOR_PID_FILE" ]; then
  echo "Emulators: NOT RUNNING"
  echo "  (no PID file found)"
else
  EMULATOR_PID=$(cat "$EMULATOR_PID_FILE")

  if kill -0 "$EMULATOR_PID" 2>/dev/null; then
    echo "Emulators: RUNNING"
    echo "  PID: ${EMULATOR_PID}"
    echo ""

    # Check each emulator port
    echo "  Services:"

    # Auth
    if nc -z localhost ${FIREBASE_AUTH_PORT} 2>/dev/null; then
      echo "    ✓ Auth: localhost:${FIREBASE_AUTH_PORT}"
    else
      echo "    ✗ Auth: localhost:${FIREBASE_AUTH_PORT} (not accessible)"
    fi

    # Firestore
    if nc -z localhost ${FIREBASE_FIRESTORE_PORT} 2>/dev/null; then
      echo "    ✓ Firestore: localhost:${FIREBASE_FIRESTORE_PORT}"
    else
      echo "    ✗ Firestore: localhost:${FIREBASE_FIRESTORE_PORT} (not accessible)"
    fi

    # Storage
    if nc -z localhost ${FIREBASE_STORAGE_PORT} 2>/dev/null; then
      echo "    ✓ Storage: localhost:${FIREBASE_STORAGE_PORT}"
    else
      echo "    ✗ Storage: localhost:${FIREBASE_STORAGE_PORT} (not accessible)"
    fi

    # UI
    if nc -z localhost ${FIREBASE_UI_PORT} 2>/dev/null; then
      echo "    ✓ UI: http://localhost:${FIREBASE_UI_PORT}"
    else
      echo "    ✗ UI: http://localhost:${FIREBASE_UI_PORT} (not accessible)"
    fi
  else
    echo "Emulators: STOPPED"
    echo "  (stale PID file found: ${EMULATOR_PID})"
    echo "  Clean up with: ./infrastructure/scripts/stop-emulators.sh"
  fi
fi

echo ""
echo "================================================"
echo ""
echo "Commands:"
echo "  Start dev server: ./infrastructure/scripts/start-dev-server.sh <module>"
echo "  Stop dev server:  ./infrastructure/scripts/stop-dev-server.sh"
echo "  Start emulators:  ./infrastructure/scripts/start-emulators.sh"
echo "  Stop emulators:   ./infrastructure/scripts/stop-emulators.sh"
