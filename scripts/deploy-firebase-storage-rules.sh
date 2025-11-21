#!/bin/bash
#
# Deploy Firebase Storage Security Rules
#
# This script deploys Firebase Storage security rules using the Firebase Management API.
# It does not require the Firebase CLI to be installed.
#
# Usage:
#   ./scripts/deploy-firebase-storage-rules.sh <rules-file> [BUCKET_NAME]
#
# Requirements:
#   - gcloud CLI authenticated
#   - Firebase enabled on the GCP project
#   - curl installed
#
# Example:
#   ./scripts/deploy-firebase-storage-rules.sh videobrowser/storage.rules rml-media
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -lt 1 ]; then
    echo -e "${RED}Error: Missing required argument${NC}" >&2
    echo "Usage: $0 <rules-file> [BUCKET_NAME]" >&2
    exit 1
fi

RULES_FILE="$1"
BUCKET_NAME="${2:-}"

if [ ! -f "$RULES_FILE" ]; then
    echo -e "${RED}Error: Rules file not found: ${RULES_FILE}${NC}" >&2
    exit 1
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: No GCP project set${NC}" >&2
    echo "Run: gcloud config set project YOUR_PROJECT_ID" >&2
    exit 1
fi

# If bucket name not provided, try to infer from rules file
if [ -z "$BUCKET_NAME" ]; then
    # Try to get from gcloud
    BUCKET_NAME=$(gcloud firebase projects:get-config --format="value(resources.storageBucket)" 2>/dev/null || echo "")

    if [ -z "$BUCKET_NAME" ]; then
        echo -e "${RED}Error: Could not determine storage bucket${NC}" >&2
        echo "Usage: $0 <rules-file> <BUCKET_NAME>" >&2
        exit 1
    fi
fi

echo -e "${YELLOW}Deploying Firebase Storage rules for bucket: ${BUCKET_NAME}${NC}"
echo -e "${YELLOW}Project: ${PROJECT_ID}${NC}"
echo -e "${YELLOW}Rules file: ${RULES_FILE}${NC}"

# Get access token
ACCESS_TOKEN=$(gcloud auth print-access-token)

# Read and escape rules file content for JSON
RULES_CONTENT=$(cat "$RULES_FILE" | jq -Rs '.')

# Create the ruleset
echo -e "${YELLOW}Creating ruleset...${NC}"
RULESET_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"source\": {
        \"files\": [
          {
            \"name\": \"storage.rules\",
            \"content\": ${RULES_CONTENT}
          }
        ]
      }
    }" \
    "https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets")

# Extract ruleset name
RULESET_NAME=$(echo "$RULESET_RESPONSE" | jq -r '.name // empty')

if [ -z "$RULESET_NAME" ]; then
    echo -e "${RED}Error: Failed to create ruleset${NC}" >&2
    echo "$RULESET_RESPONSE" | jq '.' >&2
    exit 1
fi

echo -e "${GREEN}✓ Ruleset created: ${RULESET_NAME}${NC}"

# Release the ruleset to the storage bucket
echo -e "${YELLOW}Releasing ruleset to bucket...${NC}"
RELEASE_NAME="firebase.storage/${BUCKET_NAME}"

RELEASE_RESPONSE=$(curl -s -X PATCH \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"release\": {
        \"name\": \"projects/${PROJECT_ID}/releases/${RELEASE_NAME}\",
        \"rulesetName\": \"${RULESET_NAME}\"
      }
    }" \
    "https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases/${RELEASE_NAME}")

# Check if release was successful
RELEASE_CREATED=$(echo "$RELEASE_RESPONSE" | jq -r '.name // empty')

if [ -z "$RELEASE_CREATED" ]; then
    echo -e "${RED}Error: Failed to release ruleset${NC}" >&2
    echo "$RELEASE_RESPONSE" | jq '.' >&2
    exit 1
fi

echo -e "${GREEN}✓ Rules deployed successfully!${NC}"
echo -e "${GREEN}  Bucket: ${BUCKET_NAME}${NC}"
echo -e "${GREEN}  Ruleset: ${RULESET_NAME}${NC}"
echo -e "${GREEN}  Release: ${RELEASE_CREATED}${NC}"
