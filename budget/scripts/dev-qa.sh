#!/usr/bin/env bash
# Start automated QA server for budget app
# This script orchestrates Firebase emulators, finparse server, and frontend dev server
# All services run in tmux for easy monitoring and management

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
# - PROJECT_ID, GCP_PROJECT_ID (generated per-worktree)
# - FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, STORAGE_EMULATOR_HOST (connection strings)

# Configuration for budget-specific services
FINPARSE_PORT=8080
FRONTEND_PORT=5173
TMUX_SESSION="qa-budget"

echo "========================================="
echo "Budget App - Automated QA Server"
echo "========================================="
echo ""

# ============================================================================
# PHASE 1: Start Firebase Emulators (if not already running)
# ============================================================================

echo "Checking Firebase emulators..."

if nc -z 127.0.0.1 $FIRESTORE_PORT 2>/dev/null; then
  echo "✓ Firebase emulators already running"
  echo "  Reusing shared backend emulators"
else
  echo "Starting Firebase emulators (Auth, Firestore, Storage)..."

  # Start emulators with SKIP_HOSTING=1 (we only need backend services)
  export SKIP_HOSTING=1
  "${PROJECT_ROOT}/infrastructure/scripts/start-emulators.sh" || {
    echo "ERROR: Failed to start Firebase emulators" >&2
    exit 1
  }

  echo "✓ Firebase emulators started"
fi

# Environment variables are already set by allocate-test-ports.sh:
# - FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, STORAGE_EMULATOR_HOST
# - GCP_PROJECT_ID, PROJECT_ID

echo ""

# ============================================================================
# PHASE 2: Seed Demo Data
# ============================================================================

echo "Seeding demo data..."

cd "${BUDGET_DIR}/site"
bash scripts/seed-local.sh || {
  echo "ERROR: Failed to seed demo data" >&2
  exit 1
}

echo "✓ Demo data seeded"
echo ""

# ============================================================================
# PHASE 3: Start Services in tmux
# ============================================================================

# Check if tmux session already exists
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "❌ tmux session '$TMUX_SESSION' already exists"
  echo ""
  echo "Options:"
  echo "  1. Attach to existing session: tmux attach -t $TMUX_SESSION"
  echo "  2. Stop existing session: make stop-qa"
  echo "  3. View status: make qa-status"
  exit 1
fi

echo "Creating tmux session '$TMUX_SESSION'..."

# ============================================================================
# PHASE 3A: Generate Frontend .env Configuration
# ============================================================================

echo "Generating frontend .env configuration..."

# Generate .env file with emulator configuration
"${BUDGET_DIR}/site/scripts/generate-qa-env.sh" \
  "$AUTH_PORT" "$FIRESTORE_PORT" "$STORAGE_PORT" "$PROJECT_ID" || {
  echo "ERROR: Failed to generate .env configuration" >&2
  exit 1
}

echo "✓ Frontend .env configured"
echo ""

# ============================================================================
# PHASE 3B: Start Services in tmux
# ============================================================================

# Create tmux session with first window for finparse
tmux new-session -d -s "$TMUX_SESSION" -n "finparse" \
  "cd ${PROJECT_ROOT}/finparse && export FIRESTORE_EMULATOR_HOST=localhost:${FIRESTORE_PORT} && export FIREBASE_AUTH_EMULATOR_HOST=localhost:${AUTH_PORT} && export STORAGE_EMULATOR_HOST=localhost:${STORAGE_PORT} && export GCP_PROJECT_ID=demo-test && make run-server; read -p 'Press enter to close...'"

# Create second window for frontend
tmux new-window -t "$TMUX_SESSION" -n "frontend" \
  "cd ${BUDGET_DIR}/site && pnpm dev; read -p 'Press enter to close...'"

echo "✓ tmux session created"
echo ""

# ============================================================================
# PHASE 4: Health Checks
# ============================================================================

echo "Waiting for services to start..."
echo ""

# Wait for finparse server (port 8080)
echo "Checking finparse server (port ${FINPARSE_PORT})..."
if wait_for_port ${FINPARSE_PORT} "finparse server" 60 "/dev/null"; then
  echo "✓ finparse server ready"
else
  echo "⚠️  finparse server not responding (may still be starting)"
  echo "Check logs: tmux attach -t $TMUX_SESSION"
fi

echo ""

# Wait for frontend dev server (port 5173)
echo "Checking frontend dev server (port ${FRONTEND_PORT})..."
if wait_for_port ${FRONTEND_PORT} "frontend dev server" 60 "/dev/null"; then
  echo "✓ frontend dev server ready"
else
  echo "⚠️  frontend dev server not responding (may still be starting)"
  echo "Check logs: tmux attach -t $TMUX_SESSION"
fi

echo ""

# ============================================================================
# Summary
# ============================================================================

echo "========================================="
echo "✅ Budget QA Server Ready!"
echo "========================================="
echo ""
echo "Services:"
echo "  Frontend:        http://localhost:${FRONTEND_PORT}"
echo "  Finparse API:    http://localhost:${FINPARSE_PORT}"
echo "  Firestore:       localhost:${FIRESTORE_PORT}"
echo "  Auth:            localhost:${AUTH_PORT}"
echo "  Storage:         localhost:${STORAGE_PORT}"
echo "  Emulator UI:     http://localhost:${UI_PORT}"
echo ""
echo "tmux Commands:"
echo "  Attach to session:    tmux attach -t ${TMUX_SESSION}"
echo "  List windows:         tmux list-windows -t ${TMUX_SESSION}"
echo "  Switch windows:       Ctrl+b then 'n' (next) or 'p' (previous)"
echo "  Detach from session:  Ctrl+b then 'd'"
echo ""
echo "Management:"
echo "  Check status:         make qa-status"
echo "  Stop all services:    make stop-qa"
echo ""
echo "Note: Firebase emulators are shared. Use infrastructure/scripts/stop-emulators.sh to stop them."
echo ""
