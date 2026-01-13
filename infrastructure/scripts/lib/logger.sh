#!/usr/bin/env bash

# Structured Logging Library
# Provides JSON-formatted logging for machine-parsable output and better debugging

# Log level constants
readonly LOG_LEVEL_DEBUG=0
readonly LOG_LEVEL_INFO=1
readonly LOG_LEVEL_WARN=2
readonly LOG_LEVEL_ERROR=3

# Default log level (INFO)
LOG_LEVEL="${LOG_LEVEL:-$LOG_LEVEL_INFO}"

# Get worktree name for context
get_worktree_name() {
  basename "$(git rev-parse --show-toplevel 2>/dev/null || echo 'unknown')"
}

# Get ISO 8601 timestamp with milliseconds
get_timestamp() {
  # macOS/BSD date doesn't support %3N, so we fake milliseconds
  if date --version >/dev/null 2>&1; then
    # GNU date (Linux)
    date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"
  else
    # BSD date (macOS) - fake milliseconds with nanoseconds
    local ns=$(date +%N 2>/dev/null || echo "000000000")
    local ms=$((10#${ns:0:3}))
    date -u +"%Y-%m-%dT%H:%M:%S.${ms}Z"
  fi
}

# Log a structured JSON message
# Args:
#   $1 (level): Log level (DEBUG, INFO, WARN, ERROR)
#   $2 (message): Log message
#   $3 (component): Component name (default: "unknown")
#   $4 (metadata): JSON object with additional metadata (default: "{}")
log_json() {
  local level=$1
  local message=$2
  local component=${3:-"unknown"}
  local metadata=${4:-"{}"}

  local timestamp=$(get_timestamp)
  local worktree=$(get_worktree_name)

  # Escape double quotes in message
  message=$(echo "$message" | sed 's/"/\\"/g')

  # Build JSON log entry
  local log_entry=$(cat <<EOF
{
  "timestamp": "$timestamp",
  "level": "$level",
  "component": "$component",
  "worktree": "$worktree",
  "message": "$message",
  "metadata": $metadata
}
EOF
)

  # Pretty print if jq is available, otherwise output raw JSON
  if command -v jq >/dev/null 2>&1; then
    echo "$log_entry" | jq -c .
  else
    # Output compact JSON without jq
    echo "$log_entry" | tr -d '\n'
    echo ""
  fi
}

# Convenience functions for each log level

log_debug() {
  local message=$1
  local component=${2:-"unknown"}
  local metadata=${3:-"{}"}

  if [ "$LOG_LEVEL" -le "$LOG_LEVEL_DEBUG" ]; then
    log_json "DEBUG" "$message" "$component" "$metadata"
  fi
}

log_info() {
  local message=$1
  local component=${2:-"unknown"}
  local metadata=${3:-"{}"}

  if [ "$LOG_LEVEL" -le "$LOG_LEVEL_INFO" ]; then
    log_json "INFO" "$message" "$component" "$metadata"
  fi
}

log_warn() {
  local message=$1
  local component=${2:-"unknown"}
  local metadata=${3:-"{}"}

  if [ "$LOG_LEVEL" -le "$LOG_LEVEL_WARN" ]; then
    log_json "WARN" "$message" "$component" "$metadata" >&2
  fi
}

log_error() {
  local message=$1
  local component=${2:-"unknown"}
  local metadata=${3:-"{}"}

  if [ "$LOG_LEVEL" -le "$LOG_LEVEL_ERROR" ]; then
    log_json "ERROR" "$message" "$component" "$metadata" >&2
  fi
}

# Log emulator startup event with port information
# Args:
#   $1 (emulator_type): Type of emulator (backend, hosting)
#   $2 (event_status): Status (starting, ready, failed)
#   $3 (ports_json): JSON object with port information
log_emulator_event() {
  local emulator_type=$1
  local event_status=$2
  local ports_json=${3:-"{}"}

  local message="Emulator $emulator_type: $event_status"
  log_info "$message" "emulator-$emulator_type" "$ports_json"
}

# Log lock acquisition event
# Args:
#   $1 (lock_name): Name of the lock
#   $2 (event_status): Status (acquired, waiting, timeout, stale_removed)
#   $3 (details_json): JSON object with lock details (PID, elapsed time, etc.)
log_lock_event() {
  local lock_name=$1
  local event_status=$2
  local details_json=${3:-"{}"}

  local message="Lock $lock_name: $event_status"
  log_info "$message" "lock-manager" "$details_json"
}

# Log port allocation event
# Args:
#   $1 (port): Port number
#   $2 (event_status): Status (allocated, conflict, retry, failed)
#   $3 (details_json): JSON object with allocation details
log_port_event() {
  local port=$1
  local event_status=$2
  local details_json=${3:-"{}"}

  local message="Port $port: $event_status"
  log_info "$message" "port-allocator" "$details_json"
}
