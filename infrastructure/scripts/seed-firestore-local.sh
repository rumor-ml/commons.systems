#!/usr/bin/env bash
# Seed Firestore with test data for local channel testing
# Reuses existing seeding logic from CI but for local deployments

set -euo pipefail

SITE="${1:-fellspiral}"
BRANCH_NAME="${2}"

if [ -z "$BRANCH_NAME" ]; then
  echo "Error: BRANCH_NAME is required"
  exit 1
fi

echo "Seeding Firestore for site: ${SITE}, branch: ${BRANCH_NAME}"

# Export env vars for Node.js seeding script
export GCP_PROJECT_ID="chalanding"
export FIREBASE_PROJECT_ID="chalanding"
export BRANCH_NAME="${BRANCH_NAME}"
# Note: Don't set PR_NUMBER - we want branch-based collection naming

# Run the existing seeding script (reuses CI logic)
cd "${SITE}"
node scripts/seed-firestore.js

echo "✅ Firestore seeding complete"
