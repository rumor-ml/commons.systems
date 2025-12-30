#!/usr/bin/env bash
# Deploy to local Firebase channel and run Playwright tests
# Usage:
#   ./deploy-and-test-local.sh           # Run all sites
#   ./deploy-and-test-local.sh fellspiral # Run specific site

set -euo pipefail

# Get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Configuration
PROJECT="chalanding"

# If no site specified, run all sites
if [ $# -eq 0 ]; then
  SITES=("fellspiral" "videobrowser" "audiobrowser" "print")
  echo "Running tests for all sites: ${SITES[@]}"

  for SITE in "${SITES[@]}"; do
    echo ""
    echo "========================================"
    echo "Testing site: $SITE"
    echo "========================================"
    "$0" "$SITE"  # Recursively call self with site argument
  done

  exit 0
fi

# Single site mode
SITE="$1"

# Get current branch name
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

# Sanitize branch name for Firebase channel (same logic as CI)
SANITIZED_BRANCH=$(echo "$BRANCH_NAME" | \
  tr '[:upper:]' '[:lower:]' | \
  sed 's/[^a-z0-9-]/-/g' | \
  sed 's/-\+/-/g' | \
  sed 's/^-//;s/-$//' | \
  cut -c1-63)

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${BLUE}📦 Building ${SITE}...${NC}"
echo -e "${YELLOW}Branch: ${BRANCH_NAME} → Channel: ${SANITIZED_BRANCH}${NC}"

cd "${SITE}/site"
# Build with VITE_BRANCH_NAME env var (reuses existing CI logic)
VITE_BRANCH_NAME="${BRANCH_NAME}" pnpm build

cd ../..

echo -e "${BLUE}🔒 Deploying Firestore rules...${NC}"
# Get gcloud token for Firebase authentication
FIREBASE_TOKEN=$(gcloud auth application-default print-access-token 2>&1)
firebase deploy --only firestore:rules --project "${PROJECT}" --token "$FIREBASE_TOKEN"

echo -e "${BLUE}🚀 Deploying to channel: ${SANITIZED_BRANCH}...${NC}"

# Ensure tmp directory exists
mkdir -p "${PROJECT_ROOT}/tmp/infrastructure"

firebase hosting:channel:deploy "${SANITIZED_BRANCH}" \
  --only "${SITE}" \
  --project "${PROJECT}" \
  --token "$FIREBASE_TOKEN" \
  --json > "${PROJECT_ROOT}/tmp/infrastructure/deploy-output.json"

# Extract deployed URL from JSON output (nested under site name)
DEPLOYED_URL=$(jq -r ".result.${SITE}.url" "${PROJECT_ROOT}/tmp/infrastructure/deploy-output.json")
echo -e "${GREEN}✅ Deployed to: ${DEPLOYED_URL}${NC}"

echo -e "${BLUE}🌱 Seeding test data...${NC}"
./infrastructure/scripts/seed-firestore-local.sh "${SITE}" "${BRANCH_NAME}"

echo -e "${BLUE}🧪 Running Playwright tests...${NC}"
cd "${SITE}/tests"
DEPLOYED_URL="${DEPLOYED_URL}" DEPLOYED=true pnpm test

echo -e "${GREEN}✅ Tests complete!${NC}"
