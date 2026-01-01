#!/usr/bin/env bash

# Port Utility Functions
# Reusable port management for multi-worktree emulator isolation

# System-reserved ports (NEVER allocate these)
# Includes: VoIP (SIP: 5060-5061), IRC (6665-6669), X11 (6000), and commonly-blocked ports (5000, 5001, 8000)
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
#   0 if blacklisted, 1 if not blacklisted or invalid input
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
  if nc -z 127.0.0.1 $port 2>/dev/null; then
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
# Note: Callers MUST check exit code - see allocate-test-ports.sh for example
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

# Parse PID file (format: PID:PGID)
# Args:
#   $1 (pid_file_path): Path to PID file
# Sets global variables:
#   PARSED_PID: Process ID (empty if parse failed)
#   PARSED_PGID: Process group ID (empty if not present or parse failed)
# Returns:
#   0 if valid data found, 1 if file missing or parse failed
parse_pid_file() {
  local pid_file_path=$1

  # Initialize globals
  PARSED_PID=""
  PARSED_PGID=""

  # Check if file exists
  if [ ! -f "$pid_file_path" ]; then
    return 1
  fi

  # Try to read PID:PGID format
  if IFS=':' read -r pid pgid < "$pid_file_path" 2>/dev/null; then
    # Validate we got at least a PID and that it's numeric
    if [ -n "$pid" ] && [[ "$pid" =~ ^[0-9]+$ ]]; then
      PARSED_PID="$pid"
      # Validate PGID is numeric if present
      if [ -n "$pgid" ] && ! [[ "$pgid" =~ ^[0-9]+$ ]]; then
        # Invalid PGID - clear it but still accept the valid PID
        PARSED_PGID=""
      else
        PARSED_PGID="$pgid"  # May be empty if only PID was stored
      fi
      return 0
    fi
  fi

  # Parse failed
  return 1
}

# Kill process with process group support
# Args:
#   $1 (pid): Process ID
#   $2 (pgid): Process group ID (optional)
# Returns:
#   0 on success
# Note: PGID (process group ID) allows killing entire process tree (parent + children)
#       PID fallback kills only the parent process (children may continue running)
kill_process_group() {
  local pid=$1
  local pgid=${2:-}

  if [ -n "$pgid" ]; then
    # Kill entire process group (parent + children)
    kill -TERM -$pgid 2>/dev/null || true
    sleep 1
    kill -KILL -$pgid 2>/dev/null || true
  elif [ -n "$pid" ]; then
    # Fallback to single PID (children may continue running)
    kill -TERM $pid 2>/dev/null || true
    sleep 1
    kill -KILL $pid 2>/dev/null || true
  fi

  return 0
}

# Wait for port to become available with health check
# Args:
#   $1 (port): Port number to check
#   $2 (service_name): Service name for error messages
#   $3 (max_retries): Maximum number of retry attempts
#   $4 (log_file): Path to log file to show on error
#   $5 (pid): Optional process PID to check if still running
# Returns:
#   0 on success, 1 on timeout or process crash
wait_for_port() {
  local port=$1
  local service_name=$2
  local max_retries=$3
  local log_file=$4
  local pid=${5:-}

  echo "Waiting for $service_name on port ${port}..."
  local retry_count=0

  while ! nc -z 127.0.0.1 ${port} 2>/dev/null; do
    # Check if process is still running (if PID provided)
    if [ -n "$pid" ] && ! kill -0 $pid 2>/dev/null; then
      echo "ERROR: $service_name process (PID $pid) crashed during startup" >&2
      echo "Last 50 lines of log:" >&2
      tail -n 50 "$log_file" >&2
      return 1
    fi

    retry_count=$((retry_count + 1))
    if [ $retry_count -ge $max_retries ]; then
      echo "ERROR: $service_name failed to start after ${max_retries} seconds" >&2

      if [ -n "$pid" ]; then
        echo "Process is still running but port ${port} not accepting connections" >&2
      fi

      echo "Last 50 lines of log:" >&2
      tail -n 50 "$log_file" >&2
      return 1
    fi

    sleep 1
  done

  echo "✓ $service_name ready on port ${port}"
  return 0
}
