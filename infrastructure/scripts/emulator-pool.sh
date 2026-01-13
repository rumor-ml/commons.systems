#!/usr/bin/env bash
set -euo pipefail

# INFRASTRUCTURE STABILITY FIX: Emulator pool for parallel worktrees
# Manages a pool of emulator instances that can be claimed/released by worktrees
# This allows multiple worktrees to run tests in parallel without port conflicts
#
# Architecture:
# - Pool maintains N emulator instances (configurable)
# - Each instance has its own port range and project ID
# - Worktrees claim an instance from the pool, use it, then release it
# - Pool automatically starts new instances when needed
#
# Usage:
#   emulator-pool.sh init <pool-size>     # Initialize pool with N instances
#   emulator-pool.sh claim               # Claim an available instance (outputs instance ID)
#   emulator-pool.sh release <id>        # Release instance back to pool
#   emulator-pool.sh status              # Show pool status
#   emulator-pool.sh cleanup             # Stop all instances and clean up

# Source port utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/port-utils.sh"

# Configuration
POOL_DIR="${HOME}/.firebase-emulator-pool"
POOL_CONFIG="${POOL_DIR}/pool.json"
POOL_LOCK="${POOL_DIR}/pool.lock"

# Base port ranges for pool instances
# Each instance gets a 100-port range
BASE_AUTH_PORT=10000
BASE_FIRESTORE_PORT=12000
BASE_STORAGE_PORT=14000
BASE_UI_PORT=16000
BASE_HOSTING_PORT=18000

# Ensure pool directory exists
mkdir -p "$POOL_DIR"

# Acquire pool lock
acquire_pool_lock() {
  local max_wait=30
  local wait_time=0

  while ! mkdir "$POOL_LOCK" 2>/dev/null; do
    if [ "$wait_time" -ge "$max_wait" ]; then
      echo "ERROR: Failed to acquire pool lock after ${max_wait}s" >&2
      return 1
    fi

    sleep 0.5
    wait_time=$((wait_time + 1))
  done

  echo $$ > "${POOL_LOCK}/pid"
  return 0
}

# Release pool lock
release_pool_lock() {
  rm -rf "$POOL_LOCK" 2>/dev/null || true
}

# Trap to ensure lock is always released
trap release_pool_lock EXIT

# Initialize pool configuration
init_pool() {
  local pool_size="$1"

  if ! [[ "$pool_size" =~ ^[0-9]+$ ]] || [ "$pool_size" -lt 1 ]; then
    echo "ERROR: Pool size must be a positive integer" >&2
    return 1
  fi

  acquire_pool_lock

  echo "Initializing emulator pool with $pool_size instances..."

  # Create pool configuration
  cat > "$POOL_CONFIG" <<EOF
{
  "size": $pool_size,
  "instances": []
}
EOF

  # Initialize each instance
  for ((i=0; i<pool_size; i++)); do
    local instance_id="pool-instance-$i"
    local project_id="test-pool-$i"

    # Calculate ports for this instance
    local auth_port=$((BASE_AUTH_PORT + (i * 100)))
    local firestore_port=$((BASE_FIRESTORE_PORT + (i * 100)))
    local storage_port=$((BASE_STORAGE_PORT + (i * 100)))
    local ui_port=$((BASE_UI_PORT + (i * 100)))
    local hosting_port=$((BASE_HOSTING_PORT + (i * 100)))

    echo "  Instance $i: Auth=$auth_port, Firestore=$firestore_port, Storage=$storage_port, UI=$ui_port, Hosting=$hosting_port"

    # Add instance to pool configuration
    local instance_json=$(cat <<INSTANCE_EOF
{
  "id": "$instance_id",
  "projectId": "$project_id",
  "authPort": $auth_port,
  "firestorePort": $firestore_port,
  "storagePort": $storage_port,
  "uiPort": $ui_port,
  "hostingPort": $hosting_port,
  "status": "available",
  "claimedBy": null,
  "claimedAt": null
}
INSTANCE_EOF
)

    # Append to instances array using jq
    local temp_config=$(mktemp)
    jq ".instances += [$instance_json]" "$POOL_CONFIG" > "$temp_config"
    mv "$temp_config" "$POOL_CONFIG"
  done

  echo "✓ Pool initialized with $pool_size instances"
  echo "Configuration saved to: $POOL_CONFIG"

  release_pool_lock
}

# Claim an available instance from the pool
claim_instance() {
  acquire_pool_lock

  if [ ! -f "$POOL_CONFIG" ]; then
    echo "ERROR: Pool not initialized. Run 'emulator-pool.sh init <size>' first" >&2
    release_pool_lock
    return 1
  fi

  # Find first available instance
  local instance_id=$(jq -r '.instances[] | select(.status == "available") | .id' "$POOL_CONFIG" | head -n1)

  if [ -z "$instance_id" ]; then
    echo "ERROR: No available instances in pool. All instances are claimed." >&2
    release_pool_lock
    return 1
  fi

  # Mark instance as claimed
  local worktree_path="$(pwd)"
  local claim_time=$(date +%s)

  local temp_config=$(mktemp)
  jq "(.instances[] | select(.id == \"$instance_id\") | .status) = \"claimed\" |
      (.instances[] | select(.id == \"$instance_id\") | .claimedBy) = \"$worktree_path\" |
      (.instances[] | select(.id == \"$instance_id\") | .claimedAt) = $claim_time" \
    "$POOL_CONFIG" > "$temp_config"
  mv "$temp_config" "$POOL_CONFIG"

  # Output instance configuration as JSON for easy consumption
  jq ".instances[] | select(.id == \"$instance_id\")" "$POOL_CONFIG"

  release_pool_lock
  return 0
}

# Release an instance back to the pool
release_instance() {
  local instance_id="$1"

  acquire_pool_lock

  if [ ! -f "$POOL_CONFIG" ]; then
    echo "ERROR: Pool not initialized" >&2
    release_pool_lock
    return 1
  fi

  # Mark instance as available
  local temp_config=$(mktemp)
  jq "(.instances[] | select(.id == \"$instance_id\") | .status) = \"available\" |
      (.instances[] | select(.id == \"$instance_id\") | .claimedBy) = null |
      (.instances[] | select(.id == \"$instance_id\") | .claimedAt) = null" \
    "$POOL_CONFIG" > "$temp_config"
  mv "$temp_config" "$POOL_CONFIG"

  echo "✓ Released instance: $instance_id"

  release_pool_lock
  return 0
}

# Show pool status
show_status() {
  if [ ! -f "$POOL_CONFIG" ]; then
    echo "Pool not initialized. Run 'emulator-pool.sh init <size>' to create a pool."
    return 0
  fi

  acquire_pool_lock

  local total=$(jq '.size' "$POOL_CONFIG")
  local available=$(jq '[.instances[] | select(.status == "available")] | length' "$POOL_CONFIG")
  local claimed=$(jq '[.instances[] | select(.status == "claimed")] | length' "$POOL_CONFIG")

  echo "Emulator Pool Status"
  echo "===================="
  echo "Total instances: $total"
  echo "Available: $available"
  echo "Claimed: $claimed"
  echo ""

  if [ "$claimed" -gt 0 ]; then
    echo "Claimed instances:"
    jq -r '.instances[] | select(.status == "claimed") | "  \(.id): claimed by \(.claimedBy) at \(.claimedAt)"' "$POOL_CONFIG"
  fi

  release_pool_lock
}

# Clean up pool and stop all instances
cleanup_pool() {
  if [ ! -f "$POOL_CONFIG" ]; then
    echo "Pool not initialized. Nothing to clean up."
    return 0
  fi

  acquire_pool_lock

  echo "Cleaning up emulator pool..."

  # TODO: Stop all running emulator instances
  # This would iterate through instances and stop their processes

  rm -f "$POOL_CONFIG"
  echo "✓ Pool cleaned up"

  release_pool_lock
}

# Main command dispatch
case "${1:-}" in
  init)
    if [ -z "${2:-}" ]; then
      echo "Usage: emulator-pool.sh init <pool-size>" >&2
      exit 1
    fi
    init_pool "$2"
    ;;

  claim)
    claim_instance
    ;;

  release)
    if [ -z "${2:-}" ]; then
      echo "Usage: emulator-pool.sh release <instance-id>" >&2
      exit 1
    fi
    release_instance "$2"
    ;;

  status)
    show_status
    ;;

  cleanup)
    cleanup_pool
    ;;

  *)
    echo "Usage: emulator-pool.sh <command>" >&2
    echo "" >&2
    echo "Commands:" >&2
    echo "  init <size>        Initialize pool with N instances" >&2
    echo "  claim              Claim an available instance" >&2
    echo "  release <id>       Release instance back to pool" >&2
    echo "  status             Show pool status" >&2
    echo "  cleanup            Stop all instances and clean up" >&2
    exit 1
    ;;
esac
