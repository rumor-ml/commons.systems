#!/usr/bin/env bash
# Check status of automated QA server for budget app
# Shows which services are running

set -euo pipefail

BUDGET_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUDGET_DIR="$(cd "$BUDGET_SCRIPTS_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BUDGET_DIR/.." && pwd)"

# Source port allocation to get actual emulator ports from firebase.json
# Note: Must unset SCRIPT_DIR so allocate-test-ports.sh sets it correctly
unset SCRIPT_DIR 2>/dev/null || true
source "${PROJECT_ROOT}/infrastructure/scripts/allocate-test-ports.sh"

# Port variables are now set by allocate-test-ports.sh:
# - AUTH_PORT, FIRESTORE_PORT, STORAGE_PORT, UI_PORT (from firebase.json)

# Configuration for budget-specific services
FINPARSE_PORT=8080
FRONTEND_PORT=5173
TMUX_SESSION="qa-budget"

echo "========================================="
echo "Budget App - QA Server Status"
echo "========================================="
echo ""

# Helper function to check port status
check_port() {
  local port=$1
  local service=$2
  local url=${3:-}

  if nc -z 127.0.0.1 $port 2>/dev/null; then
    if [ -n "$url" ]; then
      echo "  ✓ $service (port $port) - $url"
    else
      echo "  ✓ $service (port $port)"
    fi
    return 0
  else
    echo "  ✗ $service (port $port) - NOT RUNNING"
    return 1
  fi
}

echo "Firebase Emulators (shared):"
check_port $AUTH_PORT "Auth" "localhost:$AUTH_PORT"
check_port $FIRESTORE_PORT "Firestore" "localhost:$FIRESTORE_PORT"
check_port $STORAGE_PORT "Storage" "localhost:$STORAGE_PORT"
check_port $UI_PORT "Emulator UI" "http://localhost:$UI_PORT"

echo ""
echo "Budget App Services:"
check_port $FINPARSE_PORT "Finparse API" "http://localhost:$FINPARSE_PORT"
check_port $FRONTEND_PORT "Frontend Dev Server" "http://localhost:$FRONTEND_PORT"

echo ""
echo "tmux Session:"
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "  ✓ Session '$TMUX_SESSION' is running"
  echo ""
  echo "tmux Windows:"
  tmux list-windows -t "$TMUX_SESSION" | sed 's/^/    /'
else
  echo "  ✗ Session '$TMUX_SESSION' is NOT running"
fi

echo ""
echo "Commands:"
echo "  Attach to tmux:  tmux attach -t $TMUX_SESSION"
echo "  Start QA server: make dev-qa"
echo "  Stop QA server:  make stop-qa"
echo ""
