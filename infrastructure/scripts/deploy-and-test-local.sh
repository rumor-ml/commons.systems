#!/usr/bin/env bash
# Deploy to local Firebase channel and run Playwright tests
# Uses current git branch name (same as CI) for channel and Firestore collection naming

set -euo pipefail

# Configuration
SITE="${1:-fellspiral}"
PROJECT="chalanding"

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

firebase hosting:channel:deploy "${SANITIZED_BRANCH}" \
  --only "${SITE}" \
  --project "${PROJECT}" \
  --token "$FIREBASE_TOKEN" \
  --json > /tmp/claude/deploy-output.json

# Extract deployed URL from JSON output (nested under site name)
DEPLOYED_URL=$(jq -r ".result.${SITE}.url" /tmp/claude/deploy-output.json)
echo -e "${GREEN}✅ Deployed to: ${DEPLOYED_URL}${NC}"

echo -e "${BLUE}🌱 Seeding test data...${NC}"
./infrastructure/scripts/seed-firestore-local.sh "${SITE}" "${BRANCH_NAME}"

echo -e "${BLUE}🧪 Running Playwright tests...${NC}"
cd "${SITE}/tests"
DEPLOYED_URL="${DEPLOYED_URL}" DEPLOYED=true pnpm test

echo -e "${GREEN}✅ Tests complete!${NC}"
