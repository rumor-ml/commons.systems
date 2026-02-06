#!/usr/bin/env bash
# Seed local Firestore emulator with demo data
#
# Usage: bash scripts/seed-local.sh
#
# Prerequisites:
# - Firebase emulators must be running (FIRESTORE_EMULATOR_HOST set)
# - Node.js and pnpm installed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🌱 Seeding local Firestore emulator with budget demo data..."
echo ""

# Check if FIRESTORE_EMULATOR_HOST is set
if [[ -z "${FIRESTORE_EMULATOR_HOST:-}" ]]; then
  echo "❌ FIRESTORE_EMULATOR_HOST is not set"
  echo "Start the Firebase emulators first:"
  echo "  firebase emulators:start"
  echo ""
  echo "Or set FIRESTORE_EMULATOR_HOST manually:"
  echo "  export FIRESTORE_EMULATOR_HOST=localhost:8080"
  exit 1
fi

echo "✓ Firestore emulator detected: $FIRESTORE_EMULATOR_HOST"
echo ""

# Ensure dependencies are installed
cd "$SITE_DIR"
if [[ ! -d "node_modules" ]]; then
  echo "Installing dependencies..."
  pnpm install
  echo ""
fi

# Check if firebase-admin is installed
if [[ ! -d "node_modules/firebase-admin" ]]; then
  echo "❌ firebase-admin not found in node_modules"
  echo "Run: pnpm install"
  exit 1
fi

# Set GCP_PROJECT_ID for emulator (required by firebase-init.js)
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-demo-test}"

# Run seed script
echo "Running seed script..."
node scripts/seed-firestore.js

echo ""
echo "✅ Local seeding complete!"
