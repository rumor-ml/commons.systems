#!/usr/bin/env bash
# Generate shell variables from firebase.json emulator ports
# This keeps firebase.json as the single source of truth for port configuration

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIREBASE_JSON="${REPO_ROOT}/firebase.json"

# Validate firebase.json exists
if [ ! -f "$FIREBASE_JSON" ]; then
  echo "ERROR: firebase.json not found at $FIREBASE_JSON" >&2
  exit 1
fi

# Extract ports from firebase.json and output as shell variables for sourcing
# Purpose: Makes firebase.json the single source of truth - bash scripts source this
#          instead of hardcoding ports, preventing configuration drift
# Usage: source <(generate-firebase-ports.sh)
# Output: Lines like "AUTH_PORT=9099" using heredoc for consistent formatting
#         and reliable line endings when sourced
# Exits: Status 1 if firebase.json is missing, jq unavailable, or ports invalid
# Note: Sourcing scripts should validate all port variables are set after sourcing

# Validate jq is available
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed" >&2
  echo "Install jq: https://stedolan.github.io/jq/download/" >&2
  exit 1
fi

# Extract and validate ports
declare -A ports=(
  [auth]="AUTH_PORT"
  [firestore]="FIRESTORE_PORT"
  [storage]="STORAGE_PORT"
  [ui]="UI_PORT"
)

# Create temp file for jq stderr (reused for all emulators)
jq_stderr=$(mktemp) || {
  echo "FATAL: Failed to create temporary file" >&2
  echo "This indicates a filesystem problem (disk full, permissions, etc.)" >&2
  echo "Check /tmp space: df -h /tmp" >&2
  echo "Check /tmp permissions: ls -ld /tmp" >&2
  exit 1
}
trap 'rm -f "$jq_stderr"' EXIT

for emulator in "${!ports[@]}"; do
  var_name="${ports[$emulator]}"

  # Truncate temp file for reuse
  : > "$jq_stderr"

  if ! port_value=$(jq -r ".emulators.${emulator}.port" "$FIREBASE_JSON" 2>"$jq_stderr"); then
    echo "ERROR: jq failed for ${emulator} port extraction" >&2
    if [ -s "$jq_stderr" ]; then
      echo "jq stderr:" >&2
      cat "$jq_stderr" >&2
    fi
    echo "Check that firebase.json is valid JSON" >&2
    exit 1
  fi

  # Validate port is not null or empty
  if [ "$port_value" = "null" ] || [ -z "$port_value" ]; then
    echo "ERROR: ${emulator} port is missing or null in firebase.json" >&2
    echo "Check .emulators.${emulator}.port in firebase.json" >&2
    exit 1
  fi

  # Validate port is numeric
  if ! [[ "$port_value" =~ ^[0-9]+$ ]]; then
    echo "ERROR: ${emulator} port is not a valid number: '$port_value'" >&2
    echo "Check .emulators.${emulator}.port in firebase.json" >&2
    exit 1
  fi

  # Validate port is in valid range
  if [ "$port_value" -lt 1 ] || [ "$port_value" -gt 65535 ]; then
    echo "ERROR: ${emulator} port out of range: $port_value (must be 1-65535)" >&2
    exit 1
  fi

  # Store validated port for use in output heredoc below
  declare -g "$var_name=$port_value"
done

# Output validated ports to stdout for sourcing scripts
cat <<EOF
AUTH_PORT=${AUTH_PORT}
FIRESTORE_PORT=${FIRESTORE_PORT}
STORAGE_PORT=${STORAGE_PORT}
UI_PORT=${UI_PORT}
EOF
