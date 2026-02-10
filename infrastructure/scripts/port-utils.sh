#!/usr/bin/env bash

# Port Utility Functions
# Reusable port management for multi-worktree emulator isolation

# System-reserved ports (NEVER allocate these)
# Includes: VoIP (SIP: 5060-5061), IRC (6665-6669), X11 (6000), and commonly-blocked ports (5000, 5001, 8000)
RESERVED_PORTS=(5000 5001 5060 5061 6000 6665 6666 6667 6668 6669 8000)

# Detect if running in Claude Code sandbox environment
# Returns:
#   0 if in sandbox, 1 if not in sandbox
is_sandbox_environment() {
  # Check for CLAUDE_SANDBOX environment variable (set by Claude Code)
  if [ "${CLAUDE_SANDBOX:-}" = "true" ]; then
    return 0  # In sandbox
  fi

  # Check for other sandbox indicators if needed
  # (Can be extended with additional detection methods)

  return 1  # Not in sandbox
}

# Check if operation requires sandbox to be disabled
# Displays clear error message if in sandbox
# Args:
#   $1 (operation): Description of operation being attempted
# Returns:
#   0 if sandbox disabled (safe to proceed), 1 if in sandbox (must abort)
check_sandbox_requirement() {
  local operation="${1:-this operation}"

  if is_sandbox_environment; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "ERROR: Sandbox Restriction Detected" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "Operation: ${operation}" >&2
    echo "" >&2
    echo "This operation requires Unix socket and process group operations that" >&2
    echo "are restricted in sandboxed environments. The emulator scripts must run" >&2
    echo "with sandbox disabled." >&2
    echo "" >&2
    echo "SOLUTION:" >&2
    echo "  Run this command with dangerouslyDisableSandbox: true" >&2
    echo "" >&2
    echo "Example (Bash tool):" >&2
    echo "  {" >&2
    echo "    \"command\": \"infrastructure/scripts/start-emulators.sh\"," >&2
    echo "    \"dangerouslyDisableSandbox\": true" >&2
    echo "  }" >&2
    echo "" >&2
    echo "Why this is needed:" >&2
    echo "  - Firebase emulator requires Unix socket creation" >&2
    echo "  - Process group management requires unrestricted signal handling" >&2
    echo "  - Port allocation may require access to system networking APIs" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    return 1  # Must abort
  fi

  return 0  # Safe to proceed
}

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

# INFRASTRUCTURE STABILITY FIX: Atomic port reservation using lock files
# Reserve a port atomically using mkdir (atomic directory creation)
# Args:
#   $1 (port): Port number to reserve (1-65535)
#   $2 (lock_dir): Base directory for lock files (default: /tmp/claude/port-locks)
# Returns:
#   0 if successfully reserved, 1 if already reserved or invalid
# Note: Caller MUST call release_port() when done to clean up the lock
reserve_port() {
  local port=$1
  local lock_base_dir="${2:-/tmp/claude/port-locks}"

  # Validate port
  if ! validate_port_range "$port" "port"; then
    return 1
  fi

  # Ensure lock directory exists
  mkdir -p "$lock_base_dir" 2>/dev/null || true

  local lock_file="${lock_base_dir}/port-${port}.lock"

  # Try to create lock directory atomically
  # mkdir is atomic - either succeeds or fails, no race condition
  if mkdir "$lock_file" 2>/dev/null; then
    # Successfully reserved - store our PID
    echo $$ > "${lock_file}/pid"
    date +%s > "${lock_file}/timestamp"

    # Restrict permissions to user-only
    chmod 700 "$lock_file" 2>/dev/null || true
    chmod 600 "${lock_file}/pid" 2>/dev/null || true
    chmod 600 "${lock_file}/timestamp" 2>/dev/null || true

    return 0  # Port reserved
  fi

  # Lock already exists - check if it's stale
  if is_lock_stale "$lock_file" 300; then
    # Stale lock was removed, try again
    if mkdir "$lock_file" 2>/dev/null; then
      echo $$ > "${lock_file}/pid"
      date +%s > "${lock_file}/timestamp"
      chmod 700 "$lock_file" 2>/dev/null || true
      chmod 600 "${lock_file}/pid" 2>/dev/null || true
      chmod 600 "${lock_file}/timestamp" 2>/dev/null || true
      return 0
    fi
  fi

  return 1  # Port already reserved
}

# Release a port reservation
# Args:
#   $1 (port): Port number to release (1-65535)
#   $2 (lock_dir): Base directory for lock files (default: /tmp/claude/port-locks)
# Returns:
#   0 on success
release_port() {
  local port=$1
  local lock_base_dir="${2:-/tmp/claude/port-locks}"

  local lock_file="${lock_base_dir}/port-${port}.lock"

  if [ -d "$lock_file" ]; then
    rm -rf "$lock_file" 2>/dev/null || true
  fi

  return 0
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

# Find available port with fallback and atomic reservation
# Args:
#   $1 (base_port): Starting port number (1-65535)
#   $2 (max_attempts): Maximum number of ports to try (default: 10)
#   $3 (port_step): Step between port attempts (default: 10)
#   $4 (reserve): If "reserve", atomically reserve the port (default: no reservation)
# Returns:
#   Outputs available port to stdout, returns 0 on success, 1 on failure
# Note: Callers MUST check exit code - see allocate-test-ports.sh for example
# Note: If reserve=true, caller MUST call release_port() when done
find_available_port() {
  local base_port=$1
  local max_attempts=${2:-10}
  local port_step=${3:-10}
  local reserve=${4:-}

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
      # If reservation requested, try to reserve atomically
      if [ "$reserve" = "reserve" ]; then
        if reserve_port $candidate; then
          echo "$candidate"
          return 0
        else
          # Port was claimed by another process between availability check and reservation
          echo "⚠️  Port $candidate was claimed by another process, trying next..." >&2
          continue
        fi
      else
        # No reservation requested - just return the port
        echo "$candidate"
        return 0
      fi
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

# Check if lock directory is stale and can be safely removed
# Args:
#   $1 (lock_dir): Path to lock directory
#   $2 (max_age_seconds): Maximum age before considering stale (default: 300)
# Returns:
#   0 if stale and removed, 1 if active or cannot determine
# Note: This function will attempt to remove stale locks automatically
is_lock_stale() {
  local lock_dir=$1
  local max_age_seconds=${2:-300}  # 5 minutes default

  # Check if lock exists
  if [ ! -d "$lock_dir" ]; then
    return 1  # No lock, nothing to do
  fi

  # Read PID from lock
  local lock_pid_file="${lock_dir}/pid"
  if [ ! -f "$lock_pid_file" ]; then
    # Lock directory without PID file - likely corrupted, safe to remove
    echo "WARNING: Lock directory missing PID file, removing stale lock" >&2
    rm -rf "$lock_dir" 2>/dev/null || true
    return 0
  fi

  local lock_pid
  read -r lock_pid < "$lock_pid_file" 2>/dev/null || {
    echo "WARNING: Cannot read lock PID file, removing corrupted lock" >&2
    rm -rf "$lock_dir" 2>/dev/null || true
    return 0
  }

  # Validate PID is numeric
  if ! [[ "$lock_pid" =~ ^[0-9]+$ ]]; then
    echo "WARNING: Invalid PID in lock file ($lock_pid), removing corrupted lock" >&2
    rm -rf "$lock_dir" 2>/dev/null || true
    return 0
  fi

  # Check lock age using timestamp file (prevents indefinite hung process locks)
  local timestamp_file="${lock_dir}/timestamp"
  if [ -f "$timestamp_file" ]; then
    local lock_timestamp
    read -r lock_timestamp < "$timestamp_file" 2>/dev/null || lock_timestamp=0

    if [[ "$lock_timestamp" =~ ^[0-9]+$ ]] && [ "$lock_timestamp" -gt 0 ]; then
      local current_time=$(date +%s)
      local lock_age=$((current_time - lock_timestamp))
      local MAX_LOCK_AGE=600  # 10 minutes absolute maximum

      if [ "$lock_age" -gt "$MAX_LOCK_AGE" ]; then
        echo "Lock is $lock_age seconds old (max $MAX_LOCK_AGE), forcibly removing stale lock from PID $lock_pid" >&2
        rm -rf "$lock_dir" 2>/dev/null || true
        return 0
      fi
    fi
  fi

  # Check if process is still running
  if ! kill -0 "$lock_pid" 2>/dev/null; then
    echo "Lock holder PID $lock_pid is dead, removing stale lock" >&2
    rm -rf "$lock_dir" 2>/dev/null || true
    return 0
  fi

  # INFRASTRUCTURE STABILITY FIX: Use PID-based detection instead of fragile process name regex
  # Process is alive - check if it's actually our script by comparing PIDs from ps output
  # This avoids issues with process name truncation and special characters
  local proc_ppid proc_pgid proc_command
  if command -v ps >/dev/null 2>&1; then
    # Get process info: PPID, PGID, and command
    # Use -o args= to get full command line (not truncated comm)
    proc_info=$(ps -p "$lock_pid" -o ppid=,pgid=,args= 2>/dev/null || echo "")

    if [ -n "$proc_info" ]; then
      proc_ppid=$(echo "$proc_info" | awk '{print $1}')
      proc_pgid=$(echo "$proc_info" | awk '{print $2}')
      proc_command=$(echo "$proc_info" | cut -d' ' -f3-)

      # Check if process is related to our infrastructure scripts
      # Look for: bash/sh scripts, firebase, emulators, or our script names
      if [[ "$proc_command" =~ (bash|sh|firebase|emulator|start-emulator|allocate.*port|run-e2e) ]]; then
        # Lock is valid and active
        return 1
      else
        # Process exists but doesn't match our patterns - likely PID reuse
        echo "WARNING: Lock PID $lock_pid appears recycled (command: $proc_command)" >&2

        # Check lock age as additional validation before removing
        local lock_age
        if command -v stat >/dev/null 2>&1; then
          # macOS/BSD stat
          lock_age=$(( $(date +%s) - $(stat -f %m "$lock_dir" 2>/dev/null || echo 0) ))

          if [ "$lock_age" -gt "$max_age_seconds" ]; then
            echo "Lock is $lock_age seconds old (> $max_age_seconds), removing stale lock" >&2
            rm -rf "$lock_dir" 2>/dev/null || true
            return 0
          fi
        fi

        # Can't determine age - be conservative if lock is recent
        return 1
      fi
    fi
  fi

  # Fallback: Can't get process info - assume lock is valid
  return 1
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
  local retry_delay=0.1  # Start with 100ms
  local max_delay=5      # Cap at 5 seconds
  local elapsed_time=0

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
      echo "ERROR: $service_name failed to start after ${max_retries} retries (~${elapsed_time}s elapsed)" >&2

      if [ -n "$pid" ]; then
        echo "Process is still running but port ${port} not accepting connections" >&2
      fi

      echo "Last 50 lines of log:" >&2
      tail -n 50 "$log_file" >&2
      return 1
    fi

    # Exponential backoff: 0.1s, 0.2s, 0.4s, 0.8s, 1.6s, 3.2s, then capped at 5s
    sleep $retry_delay
    elapsed_time=$(awk "BEGIN {print $elapsed_time + $retry_delay}")

    # Double the delay for next iteration, but cap at max_delay
    retry_delay=$(awk "BEGIN {d = $retry_delay * 2; print (d > $max_delay) ? $max_delay : d}")
  done

  echo "✓ $service_name ready on port ${port}"
  return 0
}

# Check emulator health by performing actual API operations
# Returns: 0 if healthy, 1 if unhealthy
# Usage: check_emulator_health "$AUTH_HOST" "$AUTH_PORT" "$FIRESTORE_HOST" "$FIRESTORE_PORT" "$PROJECT_ID"
check_emulator_health() {
  local auth_host="$1"
  local auth_port="$2"
  local firestore_host="$3"
  local firestore_port="$4"
  local project_id="$5"

  echo "🏥 Checking emulator health..."

  # Test 1: Auth emulator health (config endpoint)
  echo "  Testing Auth emulator at ${auth_host}:${auth_port}..."
  local auth_start=$(date +%s%3N)

  local auth_response=$(curl -s -w "\n%{http_code}" \
    --connect-timeout 5 \
    --max-time 10 \
    "http://${auth_host}:${auth_port}/emulator/v1/projects/${project_id}/config" \
    2>/dev/null)

  local auth_status=$(echo "$auth_response" | tail -n1)
  local auth_end=$(date +%s%3N)
  local auth_time=$((auth_end - auth_start))

  if [[ "$auth_status" != "200" ]]; then
    echo "  ❌ Auth emulator unhealthy: HTTP $auth_status"
    return 1
  fi

  if [[ $auth_time -gt 3000 ]]; then
    echo "  ⚠️  Auth emulator slow: ${auth_time}ms (threshold: 3000ms)"
    return 1
  fi

  echo "  ✓ Auth emulator healthy (${auth_time}ms)"

  # Test 2: Firestore emulator health (root endpoint returns HTML but validates connectivity)
  echo "  Testing Firestore emulator at ${firestore_host}:${firestore_port}..."
  local firestore_start=$(date +%s%3N)

  local firestore_response=$(curl -s -w "\n%{http_code}" \
    --connect-timeout 5 \
    --max-time 10 \
    "http://${firestore_host}:${firestore_port}/" \
    2>/dev/null)

  local firestore_status=$(echo "$firestore_response" | tail -n1)
  local firestore_end=$(date +%s%3N)
  local firestore_time=$((firestore_end - firestore_start))

  if [[ "$firestore_status" != "200" ]]; then
    echo "  ❌ Firestore emulator unhealthy: HTTP $firestore_status"
    return 1
  fi

  if [[ $firestore_time -gt 3000 ]]; then
    echo "  ⚠️  Firestore emulator slow: ${firestore_time}ms (threshold: 3000ms)"
    return 1
  fi

  echo "  ✓ Firestore emulator healthy (${firestore_time}ms)"

  echo "✅ All emulators healthy"
  return 0
}

# INFRASTRUCTURE STABILITY FIX: Deep health check for emulators
# Performs actual API operations to verify functionality, not just port availability
# Args:
#   $1 (auth_host): Auth emulator host
#   $2 (auth_port): Auth emulator port
#   $3 (firestore_host): Firestore emulator host
#   $4 (firestore_port): Firestore emulator port
#   $5 (project_id): Firebase project ID
# Returns:
#   0 if healthy, 1 if unhealthy
deep_health_check() {
  local auth_host="$1"
  local auth_port="$2"
  local firestore_host="$3"
  local firestore_port="$4"
  local project_id="$5"

  echo "🔬 Performing deep health check..."

  # Test 1: Auth emulator - create test user
  echo "  Testing Auth emulator functionality..."
  local test_email="health-check-$(date +%s)@test.com"
  local test_password="test-password-123"

  local auth_response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    --connect-timeout 5 \
    --max-time 10 \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${test_email}\",\"password\":\"${test_password}\",\"returnSecureToken\":true}" \
    "http://${auth_host}:${auth_port}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key" \
    2>/dev/null)

  local auth_status=$(echo "$auth_response" | tail -n1)

  if [[ "$auth_status" != "200" ]]; then
    echo "  ❌ Auth emulator cannot create users: HTTP $auth_status" >&2
    return 1
  fi

  echo "  ✓ Auth emulator functional (user creation works)"

  # Test 2: Firestore emulator - list collections (verifies database access)
  echo "  Testing Firestore emulator functionality..."
  local firestore_response=$(curl -s -w "\n%{http_code}" \
    --connect-timeout 5 \
    --max-time 10 \
    "http://${firestore_host}:${firestore_port}/v1/projects/${project_id}/databases/(default)/documents" \
    2>/dev/null)

  local firestore_status=$(echo "$firestore_response" | tail -n1)

  # Firestore may return 200 (with documents) or 404 (no documents) - both are healthy
  if [[ "$firestore_status" != "200" ]] && [[ "$firestore_status" != "404" ]]; then
    echo "  ❌ Firestore emulator cannot access database: HTTP $firestore_status" >&2
    return 1
  fi

  echo "  ✓ Firestore emulator functional (database access works)"

  echo "✅ Deep health check passed"
  return 0
}

# INFRASTRUCTURE STABILITY FIX: Clear Firestore data between test runs
# Clear all data from Firestore emulator via REST API
# Args:
#   $1 (firestore_host): Firestore host (e.g., "localhost")
#   $2 (firestore_port): Firestore port (e.g., "11980")
#   $3 (project_id): Firebase project ID
# Returns:
#   0 on success, 1 on failure
clear_firestore_data() {
  local firestore_host="$1"
  local firestore_port="$2"
  local project_id="$3"

  echo "🗑️  Clearing Firestore emulator data..."

  # Use Firestore emulator's REST API to clear all data
  # DELETE /emulator/v1/projects/{project_id}/databases/(default)/documents
  local response=$(curl -s -w "\n%{http_code}" \
    -X DELETE \
    --connect-timeout 5 \
    --max-time 10 \
    "http://${firestore_host}:${firestore_port}/emulator/v1/projects/${project_id}/databases/(default)/documents" \
    2>/dev/null)

  local status=$(echo "$response" | tail -n1)

  if [[ "$status" != "200" ]]; then
    echo "  ⚠️  Failed to clear Firestore data: HTTP $status" >&2
    # Don't fail the test run if data clearing fails - tests may still pass
    return 1
  fi

  echo "  ✓ Firestore data cleared successfully"
  return 0
}

# Map app directory names to Firebase site IDs
# This handles apps where directory name != site ID in firebase.json
# Args:
#   $1 (app_name): App directory name
# Returns:
#   Firebase site ID (outputs to stdout)
get_firebase_site_id() {
  local app_name="$1"
  case "$app_name" in
    videobrowser) echo "videobrowser-7696a" ;;
    print) echo "print-dfb47" ;;
    budget) echo "budget-81cb7" ;;
    fellspiral) echo "fellspiral" ;;
    audiobrowser) echo "audiobrowser" ;;
    *) echo "$app_name" ;;  # Default: use app name as-is
  esac
}
