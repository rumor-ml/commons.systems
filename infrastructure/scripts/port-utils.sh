#!/usr/bin/env bash

# Port Utility Functions
# Reusable port management for multi-worktree emulator isolation

# System-reserved ports (NEVER allocate these)
# Includes browser-restricted ports (SIP: 5060-5061, IRC: 6665-6669)
RESERVED_PORTS=(5000 5001 5060 5061 6000 6665 6666 6667 6668 6669 8000)

# Validate parameter is a positive integer
# Args:
#   $1 (value): Value to validate
#   $2 (name): Parameter name for error messages
# Returns:
#   0 if valid, 1 if invalid
validate_positive_int() {
  local value=$1
  local name=$2

  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "ERROR: $name must be a positive integer, got: $value" >&2
    return 1
  fi

  if [ "$value" -lt 1 ]; then
    echo "ERROR: $name must be >= 1, got: $value" >&2
    return 1
  fi

  return 0
}

# Validate port is in valid range (1-65535)
# Args:
#   $1 (port): Port number to validate
#   $2 (name): Parameter name for error messages
# Returns:
#   0 if valid, 1 if invalid
validate_port_range() {
  local port=$1
  local name=$2

  if ! validate_positive_int "$port" "$name"; then
    return 1
  fi

  if [ "$port" -gt 65535 ]; then
    echo "ERROR: $name must be <= 65535, got: $port" >&2
    return 1
  fi

  return 0
}

# Check if port is in blacklist
# Args:
#   $1 (port): Port number to check (1-65535)
# Returns:
#   0 if blacklisted, 1 if OK, error exit if invalid input
is_port_blacklisted() {
  local port=$1

  # Validate input
  if ! validate_port_range "$port" "port"; then
    return 1
  fi

  for reserved in "${RESERVED_PORTS[@]}"; do
    if [ "$port" -eq "$reserved" ]; then
      return 0  # Port is blacklisted
    fi
  done
  return 1  # Port is OK
}

# Comprehensive port availability check
# Args:
#   $1 (port): Port number to check (1-65535)
# Returns:
#   0 if available, 1 if in use or invalid input
is_port_available() {
  local port=$1

  # Validate port is in valid range
  if ! validate_port_range "$port" "port"; then
    return 1
  fi

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
# Args:
#   $1 (base_port): Starting port number (1-65535)
#   $2 (max_attempts): Maximum number of ports to try (default: 10)
#   $3 (port_step): Step between port attempts (default: 10)
# Returns:
#   Outputs available port to stdout, returns 0 on success, 1 on failure
# TODO(#1071): Port utility functions return 1 but caller may not check exit codes
find_available_port() {
  local base_port=$1
  local max_attempts=${2:-10}
  local port_step=${3:-10}

  # Validate all parameters
  if ! validate_port_range "$base_port" "base_port"; then
    return 1
  fi
  if ! validate_positive_int "$max_attempts" "max_attempts"; then
    return 1
  fi
  if ! validate_positive_int "$port_step" "port_step"; then
    return 1
  fi

  for ((attempt=0; attempt<max_attempts; attempt++)); do
    local candidate=$((base_port + (attempt * port_step)))

    # Check if calculated port exceeds valid range
    if [ "$candidate" -gt 65535 ]; then
      echo "ERROR: Port calculation exceeded valid range (candidate: $candidate > 65535)" >&2
      return 1
    fi

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
# Args:
#   $1 (port): Port number to check (1-65535)
# Returns:
#   Outputs lsof information to stdout
get_port_owner() {
  local port=$1

  # Validate input
  if ! validate_port_range "$port" "port"; then
    return 1
  fi

  lsof -i :$port -sTCP:LISTEN | tail -n +2
}
