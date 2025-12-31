#!/usr/bin/env bash

# Port Utility Functions
# Reusable port management for multi-worktree emulator isolation

# System-reserved ports (NEVER allocate these)
# Includes browser-restricted ports (SIP: 5060-5061, IRC: 6665-6669)
RESERVED_PORTS=(5000 5001 5060 5061 6000 6665 6666 6667 6668 6669 8000)

# Check if port is in blacklist
is_port_blacklisted() {
  local port=$1
  for reserved in "${RESERVED_PORTS[@]}"; do
    if [ "$port" -eq "$reserved" ]; then
      return 0  # Port is blacklisted
    fi
  done
  return 1  # Port is OK
}

# Comprehensive port availability check
is_port_available() {
  local port=$1

  # Check 1: lsof shows no process bound to port
  if lsof -i :$port >/dev/null 2>&1; then
    return 1  # Port in use
  fi

  # Check 2: nc confirms port not listening
  if nc -z localhost $port 2>/dev/null; then
    return 1  # Port in use
  fi

  return 0  # Port available
}

# Find available port with fallback
find_available_port() {
  local base_port=$1
  local max_attempts=${2:-10}
  local port_step=${3:-10}

  for ((attempt=0; attempt<max_attempts; attempt++)); do
    local candidate=$((base_port + (attempt * port_step)))

    # Skip blacklisted ports
    if is_port_blacklisted $candidate; then
      echo "⏭️  Skipping blacklisted port $candidate" >&2
      continue
    fi

    # Check availability
    if is_port_available $candidate; then
      echo "$candidate"
      return 0
    else
      echo "⚠️  Port $candidate in use, trying next..." >&2
    fi
  done

  # All attempts exhausted
  echo "ERROR: Could not find available port in range $base_port-$((base_port + (max_attempts * port_step)))" >&2
  return 1
}

# Get process info on port (for debugging)
get_port_owner() {
  local port=$1
  lsof -i :$port -sTCP:LISTEN | tail -n +2
}
