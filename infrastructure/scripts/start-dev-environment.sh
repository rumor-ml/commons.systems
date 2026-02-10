#!/usr/bin/env bash
set -euo pipefail

# Start Dev Environment - Unified orchestrator for emulators + dev server
#
# Architecture:
# - Pool mode: Use emulator pool for parallel development
# - Singleton mode: Use dedicated emulator instance per worktree
# - Auto-seeds QA users after backend startup
#
# Usage: start-dev-environment.sh [--dry-run] [MODE] [APP_NAME]
#   --dry-run: Parse arguments and output variables (testing only)
#   MODE: Optional mode (pool, backend, or app name)
#   APP_NAME: Required when MODE=pool, otherwise optional
#
# Examples:
#   start-dev-environment.sh                    # Auto-detect app, singleton mode
#   start-dev-environment.sh fellspiral         # Run fellspiral, singleton mode
#   start-dev-environment.sh pool fellspiral    # Run fellspiral, pool mode
#   start-dev-environment.sh backend            # Backend services only

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Check for dry-run mode (testing only)
DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift  # Remove --dry-run from args
fi

# Source port utilities
source "${SCRIPT_DIR}/port-utils.sh"

# Parse arguments
MODE="${1:-}"
APP_NAME="${2:-}"

# Determine mode and app
if [ "$MODE" = "pool" ]; then
  # Pool mode: Second arg is app name
  if [ -z "$APP_NAME" ]; then
    echo "ERROR: Pool mode requires app name" >&2
    echo "Usage: start-dev-environment.sh pool <app-name>" >&2
    exit 1
  fi
  USE_POOL=1
elif [ "$MODE" = "backend" ]; then
  # Backend only mode
  USE_POOL=0
  APP_NAME=""
elif [ -n "$MODE" ]; then
  # First arg is app name
  APP_NAME="$MODE"
  USE_POOL=0
else
  # Auto-detect app from current directory
  USE_POOL=0
  CURRENT_DIR="$(basename "$PWD")"

  # Check if we're in a known app directory
  case "$CURRENT_DIR" in
    fellspiral|printsync|budget|videobrowser|audiobrowser)
      APP_NAME="$CURRENT_DIR"
      ;;
    *)
      # Check if parent is an app directory
      PARENT_DIR="$(basename "$(dirname "$PWD")")"
      case "$PARENT_DIR" in
        fellspiral|printsync|budget|videobrowser|audiobrowser)
          APP_NAME="$PARENT_DIR"
          ;;
        *)
          echo "ERROR: Could not auto-detect app from current directory" >&2
          echo "Please specify app name or run from app directory" >&2
          echo "" >&2
          echo "Usage: start-dev-environment.sh [APP_NAME]" >&2
          echo "Available apps: fellspiral, printsync, budget, videobrowser, audiobrowser" >&2
          exit 1
          ;;
      esac
      ;;
  esac
fi

# If dry-run mode, output parsed values and exit
if [ "$DRY_RUN" = "1" ]; then
  echo "MODE=$MODE"
  echo "APP_NAME=$APP_NAME"
  echo "USE_POOL=$USE_POOL"
  exit 0
fi

# Display startup banner
echo "========================================="
echo "Dev Environment Startup"
echo "========================================="
echo ""
if [ -n "$APP_NAME" ]; then
  echo "App: $APP_NAME"
else
  echo "App: Backend services only"
fi
echo "Mode: $([ "$USE_POOL" = "1" ] && echo "Pool" || echo "Singleton")"
echo ""

# ============================================================================
# PHASE 1: Start Emulators
# ============================================================================

echo "Starting Firebase emulators..."
echo ""

if [ "$USE_POOL" = "1" ]; then
  # Pool mode: Emulator pool manager handles startup
  # This would integrate with the pool allocation system
  echo "ERROR: Pool mode not yet implemented" >&2
  echo "Use singleton mode: start-dev-environment.sh $APP_NAME" >&2
  exit 1
else
  # Singleton mode: Use dedicated emulator instance
  if [ -z "$APP_NAME" ]; then
    # Backend only
    SKIP_HOSTING=1 "${SCRIPT_DIR}/start-emulators.sh"
  else
    # Full stack with hosting
    "${SCRIPT_DIR}/start-emulators.sh" "$APP_NAME"
  fi
fi

echo ""

# ============================================================================
# PHASE 2: Seed QA Users (if backend started)
# ============================================================================

# Check if backend emulators are running
source "${SCRIPT_DIR}/allocate-test-ports.sh"

if nc -z 127.0.0.1 "$AUTH_PORT" 2>/dev/null; then
  echo "Seeding QA users..."
  echo ""

  # Run the seeding script
  if ! "${SCRIPT_DIR}/seed-qa-users.js"; then
    echo "WARNING: QA user seeding failed, but continuing..." >&2
    echo "You may need to manually create test users" >&2
  fi

  echo ""
fi

# ============================================================================
# PHASE 3: Start App Dev Server (if app specified)
# ============================================================================

if [ -n "$APP_NAME" ]; then
  echo "Starting $APP_NAME dev server..."
  echo ""

  # Change to app directory
  APP_DIR="${PROJECT_ROOT}/${APP_NAME}"

  if [ ! -d "$APP_DIR" ]; then
    echo "ERROR: App directory not found: $APP_DIR" >&2
    exit 1
  fi

  if [ ! -f "$APP_DIR/Makefile" ]; then
    echo "ERROR: No Makefile found in $APP_DIR" >&2
    exit 1
  fi

  cd "$APP_DIR"

  # Start dev server (this will block until Ctrl+C)
  echo "Running: make dev"
  echo ""
  echo "========================================="
  echo "✅ Dev Environment Ready!"
  echo "========================================="
  echo ""
  echo "Backend emulators:"
  echo "  Auth: localhost:${AUTH_PORT}"
  echo "  Firestore: localhost:${FIRESTORE_PORT}"
  echo "  Storage: localhost:${STORAGE_PORT}"
  echo "  UI: http://localhost:${UI_PORT}"
  echo ""
  if [ "${SKIP_HOSTING:-0}" != "1" ]; then
    echo "Hosting: http://localhost:${HOSTING_PORT}"
    echo ""
  fi
  echo "QA User:"
  echo "  Email: qa-github@test.com"
  echo "  Provider: GitHub"
  echo "  Username: @qa-test-user"
  echo ""
  echo "Project ID: ${PROJECT_ID}"
  echo ""
  echo "Press Ctrl+C to stop all services"
  echo "========================================="
  echo ""

  # Run dev server
  exec make dev
else
  # Backend only - display status
  echo "========================================="
  echo "✅ Backend Services Ready!"
  echo "========================================="
  echo ""
  echo "Backend emulators:"
  echo "  Auth: localhost:${AUTH_PORT}"
  echo "  Firestore: localhost:${FIRESTORE_PORT}"
  echo "  Storage: localhost:${STORAGE_PORT}"
  echo "  UI: http://localhost:${UI_PORT}"
  echo ""
  echo "QA User:"
  echo "  Email: qa-github@test.com"
  echo "  Provider: GitHub"
  echo "  Username: @qa-test-user"
  echo ""
  echo "Project ID: ${PROJECT_ID}"
  echo ""
  echo "To start an app dev server:"
  echo "  cd <app-name> && make dev"
  echo ""
  echo "To stop backend emulators:"
  echo "  infrastructure/scripts/stop-emulators.sh"
  echo "========================================="
fi
