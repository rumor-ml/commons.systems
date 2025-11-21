#!/bin/bash
#
# Initialize Firebase on GCP Project
#
# This script adds Firebase to an existing GCP project programmatically,
# bypassing the need for the Firebase Console UI.
#
# Usage:
#   ./init-firebase.sh [PROJECT_ID]
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get project ID
PROJECT_ID="${1:-chalanding}"

echo -e "${BLUE}Initializing Firebase on GCP project: ${PROJECT_ID}${NC}"
echo ""

# Check if gcloud is available
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI not found${NC}"
    exit 1
fi

# Check if curl is available
if ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: curl not found${NC}"
    exit 1
fi

# Get access token
echo -e "${YELLOW}Getting access token...${NC}"
ACCESS_TOKEN=$(gcloud auth print-access-token)

# Step 1: Check if Firebase is already initialized
echo -e "${YELLOW}Checking if Firebase is already initialized...${NC}"
CHECK_RESPONSE=$(curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}" \
    -w "\n%{http_code}")

HTTP_CODE=$(echo "$CHECK_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$CHECK_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Firebase is already initialized on this project!${NC}"
    echo ""
    echo "Project details:"
    echo "$RESPONSE_BODY" | jq -r '{projectId, displayName, name}'
    echo ""
    echo -e "${GREEN}You're all set! Firebase is ready to use.${NC}"
    exit 0
fi

# Step 2: Add Firebase to the project
echo -e "${YELLOW}Firebase not initialized. Adding Firebase to project...${NC}"

# Use the Firebase Management API to add Firebase
ADD_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}:addFirebase" \
    -w "\n%{http_code}")

HTTP_CODE=$(echo "$ADD_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$ADD_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}✓ Successfully added Firebase to project!${NC}"
    echo ""
    echo "Firebase project details:"
    echo "$RESPONSE_BODY" | jq '.'
    echo ""
    echo -e "${GREEN}Firebase is now initialized and ready to use!${NC}"
elif echo "$RESPONSE_BODY" | jq -e '.error' > /dev/null 2>&1; then
    ERROR_MSG=$(echo "$RESPONSE_BODY" | jq -r '.error.message')
    ERROR_CODE=$(echo "$RESPONSE_BODY" | jq -r '.error.code')

    echo -e "${RED}Failed to add Firebase to project${NC}"
    echo -e "${RED}Error code: $ERROR_CODE${NC}"
    echo -e "${RED}Error message: $ERROR_MSG${NC}"
    echo ""

    if [[ "$ERROR_MSG" == *"PERMISSION_DENIED"* ]]; then
        echo -e "${YELLOW}You may need additional permissions.${NC}"
        echo "Try running as a project owner or with Firebase Admin role."
    elif [[ "$ERROR_MSG" == *"already exists"* ]] || [[ "$ERROR_MSG" == *"ALREADY_EXISTS"* ]]; then
        echo -e "${GREEN}Firebase is already initialized on this project!${NC}"
        exit 0
    fi

    exit 1
else
    echo -e "${RED}Unexpected response (HTTP $HTTP_CODE)${NC}"
    echo "$RESPONSE_BODY"
    exit 1
fi

# Step 3: Verify the initialization
echo ""
echo -e "${YELLOW}Verifying Firebase initialization...${NC}"
VERIFY_RESPONSE=$(curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}")

if echo "$VERIFY_RESPONSE" | jq -e '.projectId' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Firebase is successfully initialized!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Push a new commit to trigger deployment"
    echo "2. The workflow will automatically fetch Firebase config"
    echo "3. Your video browser will display videos from GCS"
else
    echo -e "${YELLOW}Warning: Could not verify Firebase initialization${NC}"
    echo "Please check manually at: https://console.firebase.google.com/"
fi
