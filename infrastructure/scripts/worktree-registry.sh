#!/usr/bin/env bash
set -euo pipefail

# Worktree Registration System
# Tracks which worktrees are using shared backend emulators to enable safe cleanup.
#
# Purpose: Maintain a registry of active worktrees using emulators, including
# which mode (singleton or pool) and optional pool instance ID. This enables
# safe cleanup of emulator resources.
#
# Registration file: ~/.firebase-emulators/worktree-registrations.json
#
# Usage:
#   worktree-registry.sh register <worktree-root> <project-id> <mode> [pool-id]
#   worktree-registry.sh unregister <worktree-root>
#   worktree-registry.sh count
#   worktree-registry.sh list

# Configuration
REGISTRY_DIR="${HOME}/.firebase-emulators"
REGISTRY_FILE="${REGISTRY_DIR}/worktree-registrations.json"
REGISTRY_LOCK="${REGISTRY_DIR}/worktree-registry.lock"

# Ensure registry directory exists
mkdir -p "$REGISTRY_DIR"

# Acquire registry lock for thread-safe operations
acquire_lock() {
  local max_wait=30
  local wait_time=0

  while ! mkdir "$REGISTRY_LOCK" 2>/dev/null; do
    if [ "$wait_time" -ge "$max_wait" ]; then
      echo "ERROR: Failed to acquire registry lock after ${max_wait}s" >&2
      return 1
    fi

    sleep 0.5
    wait_time=$((wait_time + 1))
  done

  echo $$ > "${REGISTRY_LOCK}/pid"
  return 0
}

# Release registry lock
release_lock() {
  rm -rf "$REGISTRY_LOCK" 2>/dev/null || true
}

# Trap to ensure lock is always released
trap release_lock EXIT

# Initialize registry file if it doesn't exist
init_registry() {
  if [ ! -f "$REGISTRY_FILE" ]; then
    cat > "$REGISTRY_FILE" <<EOF
{
  "registrations": []
}
EOF
  fi
}

# Validate worktree root exists
validate_worktree_root() {
  local worktree_root="$1"

  if [ ! -d "$worktree_root" ]; then
    echo "ERROR: Worktree root does not exist: $worktree_root" >&2
    return 1
  fi

  # Check if it's a git repository (either .git directory or .git file for worktrees)
  if [ ! -e "$worktree_root/.git" ]; then
    echo "ERROR: Worktree root is not a git repository: $worktree_root" >&2
    return 1
  fi

  return 0
}

# Validate mode is either "singleton" or "pool"
validate_mode() {
  local mode="$1"

  if [ "$mode" != "singleton" ] && [ "$mode" != "pool" ]; then
    echo "ERROR: Mode must be either 'singleton' or 'pool', got: $mode" >&2
    return 1
  fi

  return 0
}

# Remove stale registrations (where worktree no longer exists)
cleanup_stale_registrations() {
  local temp_file=$(mktemp)

  # Filter out registrations where worktree directory no longer exists
  # Build new registrations array by checking each entry
  local cleaned_registrations=()
  while IFS= read -r line; do
    local worktree_root=$(echo "$line" | jq -r '.worktreeRoot')
    if [ -d "$worktree_root" ]; then
      cleaned_registrations+=("$line")
    fi
  done < <(jq -c '.registrations[]' "$REGISTRY_FILE" 2>/dev/null || echo "")

  # Rebuild the JSON
  {
    echo '{"registrations": ['
    for i in "${!cleaned_registrations[@]}"; do
      echo -n "${cleaned_registrations[$i]}"
      if [ $i -lt $((${#cleaned_registrations[@]} - 1)) ]; then
        echo ","
      else
        echo ""
      fi
    done
    echo ']}'
  } > "$temp_file"

  # Validate the temp file contains valid JSON before using it
  if ! jq empty "$temp_file" 2>/dev/null; then
    echo "ERROR: Failed to generate valid JSON during cleanup" >&2
    rm -f "$temp_file"
    return 1
  fi

  mv "$temp_file" "$REGISTRY_FILE"
}

# Register a worktree
register_worktree() {
  local worktree_root="$1"
  local project_id="$2"
  local mode="$3"
  local pool_id="${4:-null}"

  if ! validate_worktree_root "$worktree_root"; then
    return 1
  fi

  if ! validate_mode "$mode"; then
    return 1
  fi

  acquire_lock

  init_registry
  cleanup_stale_registrations

  local registered_at=$(date +%s)

  # Default hosting port (can be enhanced later)
  local hosting_port=5042

  # Check if this worktree is already registered
  local existing=$(jq -r ".registrations[] | select(.worktreeRoot == \"$worktree_root\") | .worktreeRoot" "$REGISTRY_FILE" 2>/dev/null || echo "")

  if [ -n "$existing" ]; then
    # Update existing registration
    # Handle pool_id: if it's "null" keep as null, otherwise quote as string
    local pool_id_json="null"
    if [ "$pool_id" != "null" ]; then
      pool_id_json="\"$pool_id\""
    fi

    local temp_file=$(mktemp)
    jq "(.registrations[] | select(.worktreeRoot == \"$worktree_root\") | .projectId) = \"$project_id\" |
        (.registrations[] | select(.worktreeRoot == \"$worktree_root\") | .registeredAt) = $registered_at |
        (.registrations[] | select(.worktreeRoot == \"$worktree_root\") | .mode) = \"$mode\" |
        (.registrations[] | select(.worktreeRoot == \"$worktree_root\") | .poolInstanceId) = $pool_id_json" \
      "$REGISTRY_FILE" > "$temp_file"
    mv "$temp_file" "$REGISTRY_FILE"
    echo "✓ Updated registration for $worktree_root"
  else
    # Add new registration
    # Handle pool_id: if it's "null" keep as null, otherwise quote as string
    local pool_id_json="null"
    if [ "$pool_id" != "null" ]; then
      pool_id_json="\"$pool_id\""
    fi

    local new_registration=$(cat <<EOF
{
  "worktreeRoot": "$worktree_root",
  "projectId": "$project_id",
  "registeredAt": $registered_at,
  "hostingPort": $hosting_port,
  "mode": "$mode",
  "poolInstanceId": $pool_id_json
}
EOF
)

    local temp_file=$(mktemp)
    jq ".registrations += [$new_registration]" "$REGISTRY_FILE" > "$temp_file"
    mv "$temp_file" "$REGISTRY_FILE"
    echo "✓ Registered worktree: $worktree_root (mode: $mode, project: $project_id)"
  fi

  release_lock
}

# Unregister a worktree
unregister_worktree() {
  local worktree_root="$1"

  acquire_lock

  init_registry

  # Check if registration exists
  local existing=$(jq -r ".registrations[] | select(.worktreeRoot == \"$worktree_root\") | .worktreeRoot" "$REGISTRY_FILE" 2>/dev/null || echo "")

  if [ -z "$existing" ]; then
    echo "ℹ️  No registration found for: $worktree_root"
    release_lock
    return 0
  fi

  # Remove registration
  local temp_file=$(mktemp)
  jq ".registrations |= map(select(.worktreeRoot != \"$worktree_root\"))" "$REGISTRY_FILE" > "$temp_file"
  mv "$temp_file" "$REGISTRY_FILE"

  echo "✓ Unregistered worktree: $worktree_root"

  release_lock
}

# Count active registrations
count_registrations() {
  acquire_lock

  init_registry
  cleanup_stale_registrations

  local count=$(jq '.registrations | length' "$REGISTRY_FILE")
  echo "$count"

  release_lock
}

# List all registrations in human-readable format
list_registrations() {
  acquire_lock

  init_registry
  cleanup_stale_registrations

  local count=$(jq '.registrations | length' "$REGISTRY_FILE")

  if [ "$count" -eq 0 ]; then
    echo "No active worktree registrations"
    release_lock
    return 0
  fi

  echo "Active Worktree Registrations ($count):"
  echo "========================================="

  jq -r '.registrations[] |
    "Worktree:     \(.worktreeRoot)\n" +
    "Project ID:   \(.projectId)\n" +
    "Mode:         \(.mode)\n" +
    "Hosting Port: \(.hostingPort)\n" +
    "Pool ID:      \(.poolInstanceId // "none")\n" +
    "Registered:   \(.registeredAt | strftime("%Y-%m-%d %H:%M:%S"))\n" +
    "---"' \
    "$REGISTRY_FILE"

  release_lock
}

# Main entry point
main() {
  if [ $# -eq 0 ]; then
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  register <worktree-root> <project-id> <mode> [pool-id]"
    echo "    Register a worktree using emulators"
    echo "    mode: 'singleton' or 'pool'"
    echo ""
    echo "  unregister <worktree-root>"
    echo "    Unregister a worktree"
    echo ""
    echo "  count"
    echo "    Return number of active registrations"
    echo ""
    echo "  list"
    echo "    List all registrations in human-readable format"
    exit 1
  fi

  local command="$1"

  case "$command" in
    register)
      if [ $# -lt 4 ]; then
        echo "ERROR: register requires 3 arguments: worktree-root, project-id, mode" >&2
        exit 1
      fi
      register_worktree "$2" "$3" "$4" "${5:-null}"
      ;;
    unregister)
      if [ $# -lt 2 ]; then
        echo "ERROR: unregister requires 1 argument: worktree-root" >&2
        exit 1
      fi
      unregister_worktree "$2"
      ;;
    count)
      count_registrations
      ;;
    list)
      list_registrations
      ;;
    *)
      echo "ERROR: Unknown command: $command" >&2
      echo "Try '$0' for usage information" >&2
      exit 1
      ;;
  esac
}

main "$@"
