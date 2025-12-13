#!/bin/bash
# kill-all-daemons.sh - Kill all tmux-tui daemon processes and clean up files

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Killing All tmux-tui Daemons ===${NC}\n"

# Find and kill all daemon processes
DAEMON_PIDS=$(pgrep -f tmux-tui-daemon || true)

if [ -z "$DAEMON_PIDS" ]; then
  echo -e "${GREEN}No daemon processes found${NC}"
else
  echo "Found daemon processes:"
  echo "$DAEMON_PIDS" | while read -r PID; do
    CMD=$(ps -p "$PID" -o command= 2>/dev/null || echo "unknown")
    echo -e "  ${YELLOW}PID $PID:${NC} $CMD"
  done

  echo -e "\nKilling processes..."
  echo "$DAEMON_PIDS" | while read -r PID; do
    kill "$PID" 2>/dev/null && echo -e "  ${GREEN}✓ Killed PID $PID${NC}" || echo -e "  ${RED}✗ Failed to kill PID $PID${NC}"
  done
fi

# Clean up lock files and sockets in all namespaces
echo -e "\n${YELLOW}Cleaning up lock files and sockets...${NC}"

CLAUDE_DIR="/tmp/claude"
if [ -d "$CLAUDE_DIR" ]; then
  find "$CLAUDE_DIR" -name "daemon.lock" -o -name "daemon.sock" 2>/dev/null | while read -r FILE; do
    rm -f "$FILE" && echo -e "  ${GREEN}✓ Removed:${NC} $FILE"
  done
else
  echo -e "  ${YELLOW}No /tmp/claude directory found${NC}"
fi

echo -e "\n${GREEN}=== Done ===${NC}"
echo -e "All daemon processes killed and files cleaned up"
