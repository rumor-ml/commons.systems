#!/usr/bin/env bash
set -euo pipefail

# Cleanup orphaned Firebase emulator processes and stale PID files
# This script finds:
# 1. PID files in /tmp/claude/*/ where the process is no longer running (stale)
# 2. Firebase emulator processes without corresponding PID files (escaped)

echo "Scanning for orphaned Firebase emulator processes..."
echo ""

# Array to track PIDs we need to clean up
declare -a ORPHAN_PIDS=()
declare -a STALE_PID_FILES=()

# Scan for stale PID files in worktree temp directories
if [ -d "/tmp/claude" ]; then
  for worktree_dir in /tmp/claude/*/; do
    if [ -d "$worktree_dir" ]; then
      PID_FILE="${worktree_dir}firebase-emulators.pid"

      if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")

        # Check if process is still running
        if ! ps -p "$PID" >/dev/null 2>&1; then
          echo "Found stale PID file: $PID_FILE (process $PID not running)"
          STALE_PID_FILES+=("$PID_FILE")
        else
          echo "Active emulator: PID $PID (worktree dir: $(basename "$worktree_dir"))"
        fi
      fi
    fi
  done
fi

echo ""

# Find Firebase emulator processes without PID files
# Look for 'firebase emulators:start' processes
echo "Scanning for escaped Firebase emulator processes..."
ESCAPED_PIDS=$(pgrep -f 'firebase emulators:start' || true)

if [ -n "$ESCAPED_PIDS" ]; then
  for PID in $ESCAPED_PIDS; do
    # Check if this PID has a corresponding PID file
    HAS_PID_FILE=false

    if [ -d "/tmp/claude" ]; then
      for worktree_dir in /tmp/claude/*/; do
        if [ -d "$worktree_dir" ]; then
          PID_FILE="${worktree_dir}firebase-emulators.pid"

          if [ -f "$PID_FILE" ]; then
            TRACKED_PID=$(cat "$PID_FILE")
            if [ "$TRACKED_PID" = "$PID" ]; then
              HAS_PID_FILE=true
              break
            fi
          fi
        fi
      done
    fi

    if [ "$HAS_PID_FILE" = false ]; then
      echo "Found escaped emulator process: PID $PID (no PID file)"
      ORPHAN_PIDS+=("$PID")
    fi
  done
fi

echo ""

# Summary
STALE_COUNT=${#STALE_PID_FILES[@]}
ORPHAN_COUNT=${#ORPHAN_PIDS[@]}

if [ $STALE_COUNT -eq 0 ] && [ $ORPHAN_COUNT -eq 0 ]; then
  echo "✓ No orphaned emulator processes or stale PID files found"
  exit 0
fi

echo "=========================================="
echo "Summary:"
echo "  Stale PID files: $STALE_COUNT"
echo "  Escaped processes: $ORPHAN_COUNT"
echo "=========================================="
echo ""

# Clean up stale PID files
if [ $STALE_COUNT -gt 0 ]; then
  echo "Stale PID files to clean:"
  for PID_FILE in "${STALE_PID_FILES[@]}"; do
    echo "  - $PID_FILE"
  done
  echo ""

  read -p "Remove stale PID files? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    for PID_FILE in "${STALE_PID_FILES[@]}"; do
      rm -f "$PID_FILE"
      echo "✓ Removed $PID_FILE"

      # Also clean up associated log and firebase.json files
      WORKTREE_DIR=$(dirname "$PID_FILE")
      LOG_FILE="${WORKTREE_DIR}/firebase-emulators.log"
      FIREBASE_JSON="${WORKTREE_DIR}/firebase.json"

      if [ -f "$LOG_FILE" ]; then
        rm -f "$LOG_FILE"
        echo "  ✓ Removed log file"
      fi

      if [ -f "$FIREBASE_JSON" ]; then
        rm -f "$FIREBASE_JSON"
        echo "  ✓ Removed temporary Firebase config"
      fi
    done
  fi
  echo ""
fi

# Kill orphaned processes
if [ $ORPHAN_COUNT -gt 0 ]; then
  echo "Escaped emulator processes to kill:"
  for PID in "${ORPHAN_PIDS[@]}"; do
    CMDLINE=$(ps -p "$PID" -o command= || echo "unknown")
    echo "  - PID $PID: $CMDLINE"
  done
  echo ""

  read -p "Kill escaped emulator processes? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    for PID in "${ORPHAN_PIDS[@]}"; do
      if kill "$PID" 2>/dev/null; then
        echo "✓ Killed process $PID"
      else
        echo "⚠️  Could not kill process $PID (may require sudo or already stopped)"
      fi
    done
  fi
  echo ""
fi

echo "✓ Cleanup complete"
