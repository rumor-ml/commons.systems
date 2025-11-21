#!/bin/bash
#
# Get Firebase Web App Configuration
#
# This script retrieves Firebase configuration for a web app from GCP.
# The configuration is safe to expose publicly (contains only project identifiers).
#
# Usage:
#   ./scripts/get-firebase-config.sh [PROJECT_ID]
#
# Requirements:
#   - gcloud CLI authenticated
#   - Firebase enabled on the GCP project
#   - curl and jq installed
#
# Output:
#   Prints Firebase config as JSON to stdout
#   Exits with error code if Firebase is not set up
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get project ID from argument or gcloud config
PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null)}"

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: No project ID provided and no default project set${NC}" >&2
    echo "Usage: $0 [PROJECT_ID]" >&2
    exit 1
fi

echo -e "${YELLOW}Getting Firebase configuration for project: ${PROJECT_ID}${NC}" >&2

# Get access token
ACCESS_TOKEN=$(gcloud auth print-access-token)

# List Firebase web apps in the project
echo -e "${YELLOW}Fetching Firebase web apps...${NC}" >&2
APPS_RESPONSE=$(curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps")

# Check if Firebase is enabled
if echo "$APPS_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    ERROR_MESSAGE=$(echo "$APPS_RESPONSE" | jq -r '.error.message')
    echo -e "${RED}Error: ${ERROR_MESSAGE}${NC}" >&2
    echo -e "${YELLOW}Firebase may not be enabled on this project.${NC}" >&2
    echo -e "${YELLOW}Enable it at: https://console.firebase.google.com/${NC}" >&2
    exit 1
fi

# Get the first web app (or create one if none exist)
APP_ID=$(echo "$APPS_RESPONSE" | jq -r '.apps[0].appId // empty')

if [ -z "$APP_ID" ]; then
    echo -e "${YELLOW}No web apps found. Creating one...${NC}" >&2

    # Create a new web app
    CREATE_RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"displayName\": \"Video Browser Web App\"}" \
        "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps")

    # Extract app ID from response
    APP_ID=$(echo "$CREATE_RESPONSE" | jq -r '.appId // empty')

    if [ -z "$APP_ID" ]; then
        echo -e "${RED}Error: Failed to create Firebase web app${NC}" >&2
        echo "$CREATE_RESPONSE" | jq '.' >&2
        exit 1
    fi

    echo -e "${GREEN}Created new Firebase web app: ${APP_ID}${NC}" >&2
fi

# Get the app configuration
echo -e "${YELLOW}Fetching app configuration for: ${APP_ID}${NC}" >&2
CONFIG_RESPONSE=$(curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps/${APP_ID}/config")

# Extract the config
API_KEY=$(echo "$CONFIG_RESPONSE" | jq -r '.apiKey')
AUTH_DOMAIN=$(echo "$CONFIG_RESPONSE" | jq -r '.authDomain')
PROJECT_ID_RESPONSE=$(echo "$CONFIG_RESPONSE" | jq -r '.projectId')
STORAGE_BUCKET=$(echo "$CONFIG_RESPONSE" | jq -r '.storageBucket')
MESSAGING_SENDER_ID=$(echo "$CONFIG_RESPONSE" | jq -r '.messagingSenderId')
APP_ID_RESPONSE=$(echo "$CONFIG_RESPONSE" | jq -r '.appId')

# Validate we got the required fields
if [ "$API_KEY" = "null" ] || [ -z "$API_KEY" ]; then
    echo -e "${RED}Error: Failed to get Firebase configuration${NC}" >&2
    echo "$CONFIG_RESPONSE" | jq '.' >&2
    exit 1
fi

echo -e "${GREEN}✓ Firebase configuration retrieved successfully${NC}" >&2

# Output the configuration as JSON (to stdout, so it can be captured)
cat <<EOF
{
  "apiKey": "${API_KEY}",
  "authDomain": "${AUTH_DOMAIN}",
  "projectId": "${PROJECT_ID_RESPONSE}",
  "storageBucket": "${STORAGE_BUCKET}",
  "messagingSenderId": "${MESSAGING_SENDER_ID}",
  "appId": "${APP_ID_RESPONSE}"
}
EOF
