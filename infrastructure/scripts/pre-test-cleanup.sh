#!/usr/bin/env bash
# Pre-test cleanup: Remove stale processes and locks before test run

set -euo pipefail

echo "=== Pre-Test Cleanup ==="

# Kill any lingering test processes from previous runs
echo "Killing stale test processes..."
pkill -9 -f "playwright.*test" 2>/dev/null || true
pkill -9 -f "firefox.*playwright" 2>/dev/null || true
pkill -9 -f "firebase-tools emulators" 2>/dev/null || true

# Clean up stale locks older than 10 minutes
LOCK_DIR="$HOME/.firebase-emulators/firebase-backend-emulators.lock"
if [ -d "$LOCK_DIR" ]; then
  if [ -f "$LOCK_DIR/timestamp" ]; then
    lock_timestamp=$(cat "$LOCK_DIR/timestamp")
    current_time=$(date +%s)
    lock_age=$((current_time - lock_timestamp))

    if [ $lock_age -gt 600 ]; then
      echo "Removing stale lock (age: ${lock_age}s)"
      rm -rf "$LOCK_DIR"
    fi
  else
    # No timestamp = very old lock, remove it
    echo "Removing lock with no timestamp"
    rm -rf "$LOCK_DIR"
  fi
fi

# Kill processes on emulator ports
for port in 9099 8081 9199 5980 5990 6000 6010 6020; do
  if lsof -ti:$port > /dev/null 2>&1; then
    echo "Killing process on port $port"
    lsof -ti:$port | xargs kill -9 2>/dev/null || true
  fi
done

echo "✓ Pre-test cleanup complete"
