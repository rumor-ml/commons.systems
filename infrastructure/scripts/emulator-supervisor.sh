#!/usr/bin/env bash
set -euo pipefail

# INFRASTRUCTURE STABILITY FIX: Process supervisor for Firebase emulators
# Monitors emulator health continuously and restarts failed emulators automatically
# Provides clean shutdown on SIGTERM/SIGINT
#
# Usage: emulator-supervisor.sh [APP_NAME]
#   APP_NAME: Optional app name to host (e.g., fellspiral, videobrowser)

APP_NAME="${1:-}"

# Source port utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/port-utils.sh"

# PID tracking
SUPERVISOR_PID_FILE="$HOME/.firebase-emulators/supervisor.pid"

# Check sandbox requirement
check_sandbox_requirement "Running emulator supervisor" || exit 1

# Configuration
HEALTH_CHECK_INTERVAL=30  # Check every 30 seconds
MAX_RESTART_ATTEMPTS=3    # Maximum consecutive restart attempts
RESTART_BACKOFF=5         # Seconds to wait between restart attempts

# State tracking
RESTART_COUNT=0
LAST_RESTART_TIME=0

# Cleanup function for graceful shutdown
cleanup() {
  echo ""
  echo "🛑 Shutting down emulators gracefully..."

  # Clean up PID file
  rm -f "$SUPERVISOR_PID_FILE"

  # Stop emulators
  "${SCRIPT_DIR}/stop-emulators.sh" 2>/dev/null || true

  echo "✓ Emulators stopped"
  exit 0
}

# Register cleanup handlers
trap cleanup SIGTERM SIGINT EXIT

# Write PID file for external supervisor detection
mkdir -p "$HOME/.firebase-emulators"
echo $$ > "$SUPERVISOR_PID_FILE"

# Start emulators initially
echo "🚀 Starting emulators with supervisor..."
if [ -n "$APP_NAME" ]; then
  source "${SCRIPT_DIR}/start-emulators.sh" "$APP_NAME"
else
  source "${SCRIPT_DIR}/start-emulators.sh"
fi

# Load port configuration from allocate-test-ports.sh
source "${SCRIPT_DIR}/allocate-test-ports.sh"

echo ""
echo "👁️  Supervisor monitoring emulators (health check every ${HEALTH_CHECK_INTERVAL}s)"
echo "   Press Ctrl+C to stop"
echo ""

# Main supervision loop
while true; do
  sleep "$HEALTH_CHECK_INTERVAL"

  # Perform health check
  echo "⏰ [$(date +%H:%M:%S)] Running health check..."

  # Extract port numbers from host strings
  AUTH_PORT="${FIREBASE_AUTH_EMULATOR_HOST##*:}"
  FIRESTORE_PORT="${FIRESTORE_EMULATOR_HOST##*:}"

  if ! check_emulator_health "127.0.0.1" "${AUTH_PORT}" "127.0.0.1" "${FIRESTORE_PORT}" "${GCP_PROJECT_ID}"; then
    echo "❌ [$(date +%H:%M:%S)] Health check failed!"

    # Check restart throttling
    CURRENT_TIME=$(date +%s)
    TIME_SINCE_LAST_RESTART=$((CURRENT_TIME - LAST_RESTART_TIME))

    # Reset restart count if enough time has passed (10 minutes)
    if [ "$TIME_SINCE_LAST_RESTART" -gt 600 ]; then
      RESTART_COUNT=0
    fi

    # Check if we've exceeded max restart attempts
    if [ "$RESTART_COUNT" -ge "$MAX_RESTART_ATTEMPTS" ]; then
      echo "💥 [$(date +%H:%M:%S)] Maximum restart attempts ($MAX_RESTART_ATTEMPTS) exceeded"
      echo "   Waiting 10 minutes before allowing restarts again..."
      sleep 600
      RESTART_COUNT=0
      continue
    fi

    # Attempt restart
    RESTART_COUNT=$((RESTART_COUNT + 1))
    LAST_RESTART_TIME="$CURRENT_TIME"

    echo "🔄 [$(date +%H:%M:%S)] Restarting emulators (attempt $RESTART_COUNT/$MAX_RESTART_ATTEMPTS)..."

    # Stop emulators
    "${SCRIPT_DIR}/stop-emulators.sh" 2>/dev/null || true

    # Wait for cleanup
    sleep "$RESTART_BACKOFF"

    # Restart emulators
    if [ -n "$APP_NAME" ]; then
      source "${SCRIPT_DIR}/start-emulators.sh" "$APP_NAME"
    else
      source "${SCRIPT_DIR}/start-emulators.sh"
    fi

    echo "✓ [$(date +%H:%M:%S)] Emulators restarted successfully"

    # Perform immediate health check after restart
    if deep_health_check "127.0.0.1" "${AUTH_PORT}" "127.0.0.1" "${FIRESTORE_PORT}" "${GCP_PROJECT_ID}"; then
      echo "✅ [$(date +%H:%M:%S)] Post-restart health check passed"
    else
      echo "⚠️  [$(date +%H:%M:%S)] Post-restart health check failed - will retry on next interval"
    fi
  else
    echo "✅ [$(date +%H:%M:%S)] Health check passed"

    # Reset restart count on successful health check
    if [ "$RESTART_COUNT" -gt 0 ]; then
      echo "   Reset restart counter after successful check"
      RESTART_COUNT=0
    fi
  fi
done
