#!/bin/bash
# daemon-status.sh - Show status of tmux-tui daemon for diagnostics

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== tmux-tui Daemon Status ===${NC}\n"

# Check if we're in tmux
if [ -z "$TMUX" ]; then
  echo -e "${RED}Error: Must be run from within tmux${NC}"
  exit 1
fi

# Extract session name from $TMUX
TMUX_SOCKET=$(echo "$TMUX" | cut -d',' -f1)
SESSION_NAME=$(basename "$TMUX_SOCKET")
NAMESPACE="/tmp/claude/$SESSION_NAME"

echo -e "${GREEN}Namespace:${NC} $NAMESPACE"

# Check lock file
LOCK_FILE="$NAMESPACE/daemon.lock"
echo -e "\n${YELLOW}Lock File:${NC}"
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "unknown")
  echo -e "  Path: $LOCK_FILE"
  echo -e "  PID:  $LOCK_PID"

  # Check if process is running
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo -e "  ${GREEN}Status: Process running ✓${NC}"
  else
    echo -e "  ${RED}Status: Stale lock (process not running)${NC}"
  fi
else
  echo -e "  ${RED}Not found${NC}"
fi

# List all daemon processes
echo -e "\n${YELLOW}Daemon Processes:${NC}"
DAEMON_PIDS=$(pgrep -f tmux-tui-daemon || true)
if [ -z "$DAEMON_PIDS" ]; then
  echo -e "  ${RED}No daemon processes running${NC}"
else
  echo "$DAEMON_PIDS" | while read -r PID; do
    CMD=$(ps -p "$PID" -o command= 2>/dev/null || echo "unknown")
    echo -e "  ${GREEN}PID $PID:${NC} $CMD"
  done
fi

# Check socket file
SOCKET_FILE="$NAMESPACE/daemon.sock"
echo -e "\n${YELLOW}Socket File:${NC}"
if [ -S "$SOCKET_FILE" ]; then
  echo -e "  Path:   $SOCKET_FILE"
  echo -e "  ${GREEN}Status: Exists ✓${NC}"

  # Check which process has the socket open
  SOCKET_PROC=$(lsof "$SOCKET_FILE" 2>/dev/null | tail -n +2 | awk '{print $2}' | head -1 || echo "")
  if [ -n "$SOCKET_PROC" ]; then
    echo -e "  Held by PID: $SOCKET_PROC"
  fi
else
  echo -e "  ${RED}Not found${NC}"
fi

# Show recent debug logs
DEBUG_LOG="/tmp/claude/tui-debug.log"
echo -e "\n${YELLOW}Recent Debug Logs:${NC}"
if [ -f "$DEBUG_LOG" ]; then
  echo -e "  (Last 10 daemon-related entries)\n"
  grep -E "DAEMON_|LOCKFILE_|AUDIO_" "$DEBUG_LOG" 2>/dev/null | tail -10 || echo "  No daemon logs found"
else
  echo -e "  ${RED}Debug log not found${NC}"
fi

# Summary
echo -e "\n${YELLOW}=== Summary ===${NC}"
LOCK_EXISTS=0
DAEMON_RUNNING=0
SOCKET_EXISTS=0

[ -f "$LOCK_FILE" ] && LOCK_EXISTS=1
[ -n "$DAEMON_PIDS" ] && DAEMON_RUNNING=1
[ -S "$SOCKET_FILE" ] && SOCKET_EXISTS=1

if [ $LOCK_EXISTS -eq 1 ] && [ $DAEMON_RUNNING -eq 1 ] && [ $SOCKET_EXISTS -eq 1 ]; then
  echo -e "${GREEN}✓ Daemon is healthy${NC}"
  exit 0
elif [ $DAEMON_RUNNING -eq 0 ]; then
  echo -e "${RED}✗ Daemon is not running${NC}"
  exit 1
else
  echo -e "${YELLOW}⚠ Daemon may be in inconsistent state${NC}"
  exit 1
fi
