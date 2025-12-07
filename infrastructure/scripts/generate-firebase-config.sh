#!/usr/bin/env bash
set -euo pipefail

# Generate Firebase emulator config with dynamic ports
# This script creates a temporary firebase.json with ports from environment variables

# Read port variables (should be set by allocate-test-ports.sh)
AUTH_PORT=${FIREBASE_AUTH_PORT:-9099}
FIRESTORE_PORT=${FIREBASE_FIRESTORE_PORT:-8081}
STORAGE_PORT=${FIREBASE_STORAGE_PORT:-9199}
UI_PORT=${FIREBASE_UI_PORT:-4000}

# Get script and repo directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Output file in printsync directory (temp config)
OUTPUT_FILE="${REPO_ROOT}/printsync/firebase.emulator.json"

# Generate config JSON
cat > "$OUTPUT_FILE" <<EOF
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth": {
      "port": ${AUTH_PORT}
    },
    "firestore": {
      "port": ${FIRESTORE_PORT}
    },
    "storage": {
      "port": ${STORAGE_PORT}
    },
    "ui": {
      "enabled": true,
      "port": ${UI_PORT}
    }
  }
}
EOF

echo "Generated Firebase emulator config at: $OUTPUT_FILE"
echo "  Auth port: $AUTH_PORT"
echo "  Firestore port: $FIRESTORE_PORT"
echo "  Storage port: $STORAGE_PORT"
echo "  UI port: $UI_PORT"
