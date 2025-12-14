#!/usr/bin/env bash
set -euo pipefail

# Cleanup all test infrastructure for a specific worktree
# Usage: cleanup-worktree.sh <worktree-path>

if [ $# -ne 1 ]; then
  echo "Usage: $0 <worktree-path>"
  echo ""
  echo "Cleans up all test infrastructure for the specified worktree:"
  echo "  - Stops running Firebase emulators"
  echo "  - Removes worktree-specific temp directory"
  echo "  - Removes temporary Firebase config from repo root"
  echo ""
  echo "Example: $0 /Users/name/worktrees/my-branch"
  exit 1
fi

WORKTREE_PATH="$1"

# Validate that the path exists and is a git worktree
if [ ! -d "$WORKTREE_PATH" ]; then
  echo "ERROR: Directory does not exist: $WORKTREE_PATH"
  exit 1
fi

# Check if it's a git repository
if ! git -C "$WORKTREE_PATH" rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: Not a git repository: $WORKTREE_PATH"
  exit 1
fi

# Get the absolute path
WORKTREE_ROOT="$(cd "$WORKTREE_PATH" && git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"

# Calculate the hash for this worktree (same logic as allocate-test-ports.sh)
WORKTREE_HASH=$(echo -n "$WORKTREE_ROOT" | cksum | awk '{print $1}')
WORKTREE_TMP_DIR="/tmp/claude/${WORKTREE_HASH}"

echo "=========================================="
echo "Cleanup for worktree: $WORKTREE_NAME"
echo "Path: $WORKTREE_ROOT"
echo "Hash: $WORKTREE_HASH"
echo "Temp directory: $WORKTREE_TMP_DIR"
echo "=========================================="
echo ""

# Check for running emulators
PID_FILE="${WORKTREE_TMP_DIR}/firebase-emulators.pid"

if [ -f "$PID_FILE" ]; then
  EMULATOR_PID=$(cat "$PID_FILE")

  echo "Found Firebase emulator PID file: $PID_FILE"

  if ps -p "$EMULATOR_PID" >/dev/null 2>&1; then
    echo "Stopping running emulator (PID: $EMULATOR_PID)..."

    if kill "$EMULATOR_PID" 2>/dev/null; then
      echo "✓ Stopped emulator process $EMULATOR_PID"

      # Wait a moment for graceful shutdown
      sleep 2

      # Force kill if still running
      if ps -p "$EMULATOR_PID" >/dev/null 2>&1; then
        kill -9 "$EMULATOR_PID" 2>/dev/null || true
        echo "✓ Force-killed emulator process $EMULATOR_PID"
      fi
    else
      echo "⚠️  Could not stop emulator process $EMULATOR_PID"
    fi
  else
    echo "⚠️  Emulator process $EMULATOR_PID is not running (stale PID file)"
  fi
else
  echo "No emulator PID file found - emulators not running"
fi

echo ""

# Remove worktree-specific temp directory
if [ -d "$WORKTREE_TMP_DIR" ]; then
  echo "Removing worktree temp directory: $WORKTREE_TMP_DIR"

  # Show what's in the directory
  echo "Contents:"
  ls -lh "$WORKTREE_TMP_DIR" || true
  echo ""

  rm -rf "$WORKTREE_TMP_DIR"
  echo "✓ Removed temp directory"
else
  echo "Temp directory does not exist: $WORKTREE_TMP_DIR"
fi

echo ""

# Clean up old-style firebase config in repo root (legacy cleanup)
# Old scripts created .firebase-${HASH}.json in repo root
OLD_FIREBASE_JSON="${WORKTREE_ROOT}/.firebase-${WORKTREE_HASH}.json"
if [ -f "$OLD_FIREBASE_JSON" ]; then
  echo "Removing legacy Firebase config: $OLD_FIREBASE_JSON"
  rm -f "$OLD_FIREBASE_JSON"
  echo "✓ Removed legacy Firebase config"
fi

echo ""
echo "=========================================="
echo "✓ Cleanup complete for worktree: $WORKTREE_NAME"
echo "=========================================="
